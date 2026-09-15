import { route, schoolCalendarDay, tenant, trip, tripStudent, type Database } from '@servisapp/db';
import { isOperationalFact, plannedDepartureAt, ymdInTimeZone } from '@servisapp/domain';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { notFound } from '../http-error.js';
import {
  loadHorizonRouteVersions,
  pickApplicableRouteVersions,
} from './applicable-route-versions.js';
import { insertPlanEvent } from './plan-reconcile.js';
import { buildTripPlan, writeTripSnapshot } from './trips.js';

/**
 * Plan ile üretilmiş sefer arasındaki kopukluğu kapatan katman.
 *
 * Sefer, üretildiği anın anlığını (rota sürümü + durak + öğrenci kopyası) taşır.
 * Ufuk 7 gün olduğu için plan sonradan değiştiğinde — yeni rota sürümü yayınlanır
 * ya da gün tatil ilan edilir — çoktan üretilmiş seferler eski gerçeği anlatmaya
 * devam ediyordu. Burada henüz başlamamış (PLANNED/READY) seferler yetkili plana
 * göre yeniden kurulur veya iptal edilir.
 *
 * Başlamış sefere (ACTIVE ve sonrası) ve üstünde operasyon gerçeği yazılmış
 * öğrenciye dokunulmaz; bu seferler `blocked` olarak raporlanır — sessizce
 * düzeltilmiş gibi yapmak sahadaki gerçeği ezmek olur.
 */

export type TripReconcileBlock = {
  tripId: string;
  serviceDate: string;
  reason: 'trip_started' | 'operational_fact' | 'no_applicable_version';
};

export interface TripReconcileResult {
  inspected: number;
  rebuilt: number;
  cancelled: number;
  unchanged: number;
  blocked: TripReconcileBlock[];
}

export interface TripReconcileScope {
  /** Yalnız bu rotalar. Verilmezse kiracının tümü. */
  routeIds?: string[];
  /** Yalnız bu okullar. Verilmezse kiracının tümü. */
  schoolIds?: string[];
  /** Bu günden itibaren; bugünden geriye asla gidilmez. */
  fromDate?: string;
  /** Yalnız bu servis günü. */
  serviceDate?: string;
}

const OPEN_STATES = ['PLANNED', 'READY'] as const;

function emptyResult(): TripReconcileResult {
  return { inspected: 0, rebuilt: 0, cancelled: 0, unchanged: 0, blocked: [] };
}

function dateOnly(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export async function reconcileOpenTripsTx(
  tx: Database,
  tenantId: string,
  scope: TripReconcileScope = {},
): Promise<TripReconcileResult> {
  const [tenantRow] = await tx
    .select({ timezone: tenant.timezone })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!tenantRow) throw notFound('Şirket bulunamadı');
  const timezone = tenantRow.timezone;
  const today = ymdInTimeZone(new Date(), timezone);
  // Geçmiş gün yeniden kurulmaz: olan olmuştur.
  const fromDate = scope.fromDate && scope.fromDate > today ? scope.fromDate : today;
  if (scope.serviceDate && scope.serviceDate < fromDate) return emptyResult();

  const candidates = await tx
    .select({
      id: trip.id,
      routeId: trip.routeId,
      routeVersionId: trip.routeVersionId,
      serviceDate: trip.serviceDate,
      segment: trip.segment,
      state: trip.state,
      plannedDepartureAt: trip.plannedDepartureAt,
      vehicleId: trip.currentVehicleId,
      schoolId: route.schoolId,
      routeRetiredAt: route.retiredAt,
    })
    .from(trip)
    .innerJoin(route, and(eq(route.id, trip.routeId), eq(route.tenantId, tenantId)))
    .where(
      and(
        eq(trip.tenantId, tenantId),
        inArray(trip.state, [...OPEN_STATES]),
        scope.serviceDate
          ? eq(trip.serviceDate, scope.serviceDate)
          : gte(trip.serviceDate, fromDate),
        ...(scope.routeIds && scope.routeIds.length > 0
          ? [inArray(trip.routeId, scope.routeIds)]
          : []),
        ...(scope.schoolIds && scope.schoolIds.length > 0
          ? [inArray(route.schoolId, scope.schoolIds)]
          : []),
      ),
    );
  if (candidates.length === 0) return emptyResult();

  const versions = await loadHorizonRouteVersions(tx, tenantId);
  const result = emptyResult();

  const ordered = [...candidates].sort(
    (left, right) =>
      dateOnly(left.serviceDate).localeCompare(dateOnly(right.serviceDate)) ||
      left.routeId.localeCompare(right.routeId),
  );

  for (const candidate of ordered) {
    const day = dateOnly(candidate.serviceDate);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:${candidate.routeId}`}), hashtext(${day}))`,
    );
    const [locked] = await tx
      .select({ state: trip.state, routeVersionId: trip.routeVersionId })
      .from(trip)
      .where(and(eq(trip.id, candidate.id), eq(trip.tenantId, tenantId)))
      .for('update');
    if (!locked) continue;
    result.inspected += 1;
    if (!(OPEN_STATES as readonly string[]).includes(locked.state)) {
      await recordBlocked(tx, tenantId, candidate, locked.state, 'trip_started');
      result.blocked.push({ tripId: candidate.id, serviceDate: day, reason: 'trip_started' });
      continue;
    }

    const students = await tx
      .select({ state: tripStudent.state })
      .from(tripStudent)
      .where(and(eq(tripStudent.tenantId, tenantId), eq(tripStudent.tripId, candidate.id)));
    if (students.some((row) => isOperationalFact(row.state))) {
      await recordBlocked(tx, tenantId, candidate, locked.state, 'operational_fact');
      result.blocked.push({ tripId: candidate.id, serviceDate: day, reason: 'operational_fact' });
      continue;
    }

    if (candidate.routeRetiredAt) {
      // Emekliye ayrılan güzergâhın henüz başlamamış seferi yürümez.
      await cancelTrip(tx, tenantId, candidate, 'Güzergâh emekliye ayrıldı');
      result.cancelled += 1;
      continue;
    }

    const [holiday] = await tx
      .select({ date: schoolCalendarDay.date })
      .from(schoolCalendarDay)
      .where(
        and(
          eq(schoolCalendarDay.tenantId, tenantId),
          eq(schoolCalendarDay.schoolId, candidate.schoolId),
          eq(schoolCalendarDay.date, day),
          eq(schoolCalendarDay.type, 'HOLIDAY'),
        ),
      );
    if (holiday) {
      await cancelTrip(tx, tenantId, candidate, 'Okul takviminde tatil ilan edildi');
      result.cancelled += 1;
      continue;
    }

    const applicable = pickApplicableRouteVersions(versions, day).find(
      (item) => item.routeId === candidate.routeId,
    );
    if (!applicable) {
      await recordBlocked(tx, tenantId, candidate, locked.state, 'no_applicable_version');
      result.blocked.push({
        tripId: candidate.id,
        serviceDate: day,
        reason: 'no_applicable_version',
      });
      continue;
    }

    const departure = plannedDepartureAt(
      day,
      candidate.segment,
      timezone,
      applicable.departureLocalTime,
    );
    const versionChanged = applicable.versionId !== locked.routeVersionId;
    const departureChanged =
      departure.getTime() !== new Date(candidate.plannedDepartureAt).getTime();
    if (!versionChanged && !departureChanged) {
      result.unchanged += 1;
      continue;
    }

    const plan = await buildTripPlan(tx, {
      tenantId,
      serviceDate: day,
      route: applicable,
    });
    if (!plan) {
      await cancelTrip(tx, tenantId, candidate, 'Yeni rota sürümünde bu güne öğrenci düşmüyor');
      result.cancelled += 1;
      continue;
    }

    await clearTripSnapshot(tx, candidate.id);
    await writeTripSnapshot(tx, {
      tenantId,
      tripId: candidate.id,
      serviceDate: day,
      segment: candidate.segment,
      plan,
    });
    await tx
      .update(trip)
      .set({
        routeVersionId: applicable.versionId,
        plannedDepartureAt: departure,
        routeBaseline: null,
        baselineComputedAt: null,
      })
      .where(and(eq(trip.id, candidate.id), eq(trip.tenantId, tenantId)));
    await insertPlanEvent(tx, {
      tenantId,
      membershipId: null,
      role: 'SYSTEM',
      tripId: candidate.id,
      vehicleId: candidate.vehicleId,
      subjectType: 'TRIP',
      subjectId: candidate.id,
      eventType: 'TRIP_REBUILT',
      prevState: locked.state,
      newState: locked.state,
      payload: {
        fromRouteVersionId: locked.routeVersionId,
        toRouteVersionId: applicable.versionId,
        plannedDepartureAt: departure.toISOString(),
      },
    });
    result.rebuilt += 1;
  }

  return result;
}

/**
 * Plan değişikliği sefere yansıtılamadıysa bunu sessizce yutmayız; seferin
 * kendi olay akışına yazarız ki yönetici paneli "bu sefer eski planla çıkıyor"
 * gerçeğini görebilsin.
 */
async function recordBlocked(
  tx: Database,
  tenantId: string,
  candidate: { id: string; vehicleId: string },
  state: string,
  reason: TripReconcileBlock['reason'],
): Promise<void> {
  await insertPlanEvent(tx, {
    tenantId,
    membershipId: null,
    role: 'SYSTEM',
    tripId: candidate.id,
    vehicleId: candidate.vehicleId,
    subjectType: 'TRIP',
    subjectId: candidate.id,
    eventType: 'PLAN_CHANGE_BLOCKED',
    prevState: state,
    newState: state,
    payload: { reason },
  });
}

async function cancelTrip(
  tx: Database,
  tenantId: string,
  candidate: { id: string; state: string; vehicleId: string },
  reason: string,
): Promise<void> {
  await tx
    .update(trip)
    .set({ state: 'CANCELLED', cancelReason: reason })
    .where(and(eq(trip.id, candidate.id), eq(trip.tenantId, tenantId)));
  await insertPlanEvent(tx, {
    tenantId,
    membershipId: null,
    role: 'SYSTEM',
    tripId: candidate.id,
    vehicleId: candidate.vehicleId,
    subjectType: 'TRIP',
    subjectId: candidate.id,
    eventType: 'TRIP_CANCELLED',
    prevState: candidate.state,
    newState: 'CANCELLED',
    payload: { reason },
  });
}

/**
 * Durak ve öğrenci kopyası silinir; sefer satırı ve olay geçmişi korunur.
 * Silme yetkisi API rolünde yoktur — kontrol DB tarafındaki definer fonksiyonda
 * (başlamamış sefer + operasyon gerçeği yok) tekrar edilir.
 */
async function clearTripSnapshot(tx: Database, tripId: string): Promise<void> {
  await tx.execute(sql`select clear_trip_snapshot(${tripId}::uuid)`);
}
