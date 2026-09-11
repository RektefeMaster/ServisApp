import type {
  AdminEventsList,
  AdminPrioritiesList,
  AssignTripCrewInput,
  AssignTripVehicleInput,
  CreateStudentTripMoveInput,
  StudentTripMoveResult,
  TripSummary,
} from '@servisapp/contracts';
import {
  address,
  criticalChangeAck,
  criticalChangeAlert,
  deliveryOverride,
  event,
  membershipRole,
  route,
  school,
  student,
  studentTripMove,
  tenant,
  tenantMembership,
  trip,
  tripCrewAssignment,
  tripStop,
  tripStopStudent,
  tripStudent,
  tripVehicleAssignment,
  vehicle,
  vehicleCurrentLocation,
  withTenant,
  type Database,
} from '@servisapp/db';
import {
  checkCapacity,
  countsTowardCapacity,
  deliveryTargetForSegment,
  exhaustive,
  gpsWatchdog,
  occupancyForSegment,
  pickStudentAnchorStop,
  reconcileStudent,
  tripReadyCrewBlock,
  ymdInTimeZone,
  zonedDayEnd,
  zonedDayStart,
  type StudentState,
} from '@servisapp/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http-error.js';
import { isUniqueViolation, mapDbError } from './db-error.js';
import {
  applyTripStudentPlan,
  findOpenTripStudents,
  insertPlanEvent,
  raiseCriticalAlert,
} from './plan-reconcile.js';
import type { TripActor } from './ports.js';
import { firstRow } from './sql-result.js';
import { studentHomePoint } from './student-home.js';
import { refreshRoutesIfTripChanged } from './tracking.js';

const OPEN_TRIP_STATES = ['PLANNED', 'READY', 'ACTIVE'] as const;
const IN_SERVICE_STATES = ['READY', 'ACTIVE'] as const;
const LIST_LIMIT = 200;

function asYmd(value: string | Date): string {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match?.[1]) return match[1];
  } else {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.toISOString());
    if (match?.[1]) return match[1];
  }
  throw new HttpError(500, 'invalid_date', 'Tarih okunamadı');
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function eventsToCsv(items: AdminEventsList['items']): string {
  const lines = [
    'seq,occurred_at,event_type,subject_type,subject_id,trip_id,prev_state,new_state,actor_role',
  ];
  for (const row of items) {
    lines.push(
      [
        csvCell(row.seq),
        csvCell(row.occurredAt),
        csvCell(row.eventType),
        csvCell(row.subjectType),
        csvCell(row.subjectId),
        csvCell(row.tripId),
        csvCell(row.prevState),
        csvCell(row.newState),
        csvCell(row.actorRole),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function withOps<T>(
  db: Database,
  tenantId: string,
  membershipId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await withTenant(db, { tenantId, membershipId, role: 'ADMIN' }, fn);
  } catch (error) {
    if (isUniqueViolation(error, 'student_trip_move_unique')) {
      throw conflict('move_exists', 'Bu gün ve sefer için zaten transfer var');
    }
    mapDbError(error);
  }
}

async function lockTrip(tx: Database, tenantId: string, tripId: string): Promise<void> {
  const row = firstRow(
    await tx.execute(
      sql`select id from trip where id = ${tripId}::uuid and tenant_id = ${tenantId}::uuid for update`,
    ),
  );
  if (!row) throw notFound('Sefer bulunamadı');
}

function assertOpenTrip(state: string): void {
  if (!OPEN_TRIP_STATES.includes(state as (typeof OPEN_TRIP_STATES)[number])) {
    throw conflict('trip_closed', 'Kapalı seferde operasyon değişmez');
  }
}

interface LoadedTrip {
  id: string;
  routeId: string;
  segment: 'MORNING' | 'AFTERNOON';
  state: string;
  serviceDate: string;
  vehicleId: string;
  plate: string;
  seatCount: number;
  schoolId: string;
  schoolName: string;
  attendantRequired: boolean;
  driverId: string | null;
  attendantId: string | null;
  locationSessionEpoch: number;
  plannedDepartureAt: Date | string;
  maxDetourM: number;
}

async function loadTrip(tx: Database, tenantId: string, tripId: string): Promise<LoadedTrip> {
  const [row] = await tx
    .select({
      id: trip.id,
      routeId: trip.routeId,
      segment: trip.segment,
      state: trip.state,
      serviceDate: trip.serviceDate,
      vehicleId: trip.currentVehicleId,
      plate: vehicle.plate,
      seatCount: vehicle.seatCount,
      schoolId: route.schoolId,
      schoolName: school.name,
      attendantRequired: school.attendantRequired,
      driverId: trip.currentDriverMembershipId,
      attendantId: trip.currentAttendantMembershipId,
      locationSessionEpoch: trip.locationSessionEpoch,
      plannedDepartureAt: trip.plannedDepartureAt,
      maxDetourM: route.maxDetourM,
    })
    .from(trip)
    .innerJoin(route, and(eq(route.id, trip.routeId), eq(route.tenantId, tenantId)))
    .innerJoin(vehicle, and(eq(vehicle.id, trip.currentVehicleId), eq(vehicle.tenantId, tenantId)))
    .innerJoin(school, and(eq(school.id, route.schoolId), eq(school.tenantId, tenantId)))
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  if (!row) throw notFound('Sefer bulunamadı');
  return { ...row, serviceDate: asYmd(row.serviceDate) };
}

function instantIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(500, 'invalid_date', 'Tarih okunamadı');
  return date.toISOString().replace(/Z$/, '+00:00');
}

function toSummary(row: LoadedTrip, plate?: string, vehicleId?: string): TripSummary {
  return {
    id: row.id,
    routeId: row.routeId,
    serviceDate: row.serviceDate,
    segment: row.segment,
    state: row.state as TripSummary['state'],
    plannedDepartureAt: instantIso(row.plannedDepartureAt),
    vehicleId: vehicleId ?? row.vehicleId,
    plate: plate ?? row.plate,
    schoolName: row.schoolName,
  };
}

function assertCrewComplete(
  row: LoadedTrip,
  nextDriver: string | null,
  nextAttendant: string | null,
): void {
  if (row.state !== 'READY' && row.state !== 'ACTIVE') return;
  const block = tripReadyCrewBlock({
    driverMembershipId: nextDriver,
    attendantMembershipId: nextAttendant,
    attendantRequired: row.attendantRequired,
  });
  switch (block) {
    case null:
      return;
    case 'DRIVER_MISSING':
      throw conflict('crew_incomplete', 'Şoför atanmadan sefer hazır kalamaz');
    case 'ATTENDANT_MISSING':
      throw conflict('crew_incomplete', 'Hostes atanmadan sefer hazır kalamaz');
    default:
      return exhaustive(block, 'assertCrewComplete');
  }
}

async function assertCapacity(
  tx: Database,
  tenantId: string,
  tripId: string,
  segment: 'MORNING' | 'AFTERNOON',
  seatCount: number,
  extra?: { studentId: string; stopId: string },
): Promise<void> {
  const stopRows = await tx
    .select({ id: tripStop.id, seq: tripStop.seq, kind: tripStop.kind })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, tripId), eq(tripStop.tenantId, tenantId)))
    .orderBy(asc(tripStop.seq));
  const studentRows = await tx
    .select({ studentId: tripStudent.studentId, state: tripStudent.state })
    .from(tripStudent)
    .where(and(eq(tripStudent.tripId, tripId), eq(tripStudent.tenantId, tenantId)));
  const active = new Set(
    studentRows.filter((row) => countsTowardCapacity(row.state)).map((row) => row.studentId),
  );
  if (extra) active.add(extra.studentId);
  const links =
    stopRows.length === 0
      ? []
      : await tx
          .select({
            tripStopId: tripStopStudent.tripStopId,
            studentId: tripStopStudent.studentId,
          })
          .from(tripStopStudent)
          .where(
            and(
              eq(tripStopStudent.tenantId, tenantId),
              inArray(
                tripStopStudent.tripStopId,
                stopRows.map((row) => row.id),
              ),
            ),
          );
  const byStop = new Map<string, string[]>();
  for (const link of links) {
    if (!active.has(link.studentId)) continue;
    const list = byStop.get(link.tripStopId) ?? [];
    list.push(link.studentId);
    byStop.set(link.tripStopId, list);
  }
  if (extra) {
    const list = byStop.get(extra.stopId) ?? [];
    if (!list.includes(extra.studentId)) list.push(extra.studentId);
    byStop.set(extra.stopId, list);
  }
  const planStops = stopRows.map((row) => ({
    stopId: row.id,
    seq: Number(row.seq),
    kind: row.kind,
    studentIds: byStop.get(row.id) ?? [],
  }));
  const extraStop = extra ? stopRows.find((row) => row.id === extra.stopId) : undefined;
  if (extra && extraStop?.kind === 'SCHOOL') {
    const seqs = stopRows.map((row) => Number(row.seq));
    const phantomSeq =
      seqs.length === 0 ? 0 : segment === 'MORNING' ? Math.min(...seqs) - 1 : Math.max(...seqs) + 1;
    planStops.push({
      stopId: extra.stopId,
      seq: phantomSeq,
      kind: segment === 'MORNING' ? 'PICKUP' : 'DROPOFF',
      studentIds: [extra.studentId],
    });
  }
  const check = checkCapacity(occupancyForSegment(segment, planStops), seatCount);
  if (!check.ok) {
    throw conflict(
      'capacity_exceeded',
      `Anlık zirve ${check.peak} öğrenci, araçta ${check.seatCount} koltuk var`,
    );
  }
}

async function invalidateTripLocation(
  tx: Database,
  tenantId: string,
  tripId: string,
): Promise<void> {
  await tx
    .update(vehicleCurrentLocation)
    .set({ quality: 'REJECTED', isStale: true })
    .where(
      and(eq(vehicleCurrentLocation.tenantId, tenantId), eq(vehicleCurrentLocation.tripId, tripId)),
    );
}

async function lockInServiceKeys(tx: Database, keys: string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('in-service'), hashtext(${key}))`);
  }
}

/** Aynı araç veya kişi iki READY|ACTIVE seferde olamaz — GPS satırı araç başına tektir. */
export async function assertTripResourcesIdle(
  tx: Database,
  input: {
    tenantId: string;
    tripId: string;
    serviceDate: string;
    vehicleId?: string | null;
    membershipIds?: ReadonlyArray<string | null>;
  },
): Promise<void> {
  const crewIds = [
    ...new Set(input.membershipIds?.filter((id): id is string => typeof id === 'string') ?? []),
  ];
  const keys = [
    ...(input.vehicleId ? [`vehicle:${input.tenantId}:${input.vehicleId}`] : []),
    ...crewIds.map((id) => `crew:${input.tenantId}:${id}`),
  ];
  await lockInServiceKeys(tx, keys);
  if (input.vehicleId) {
    const [busyVehicle] = await tx
      .select({ id: trip.id })
      .from(trip)
      .where(
        and(
          eq(trip.tenantId, input.tenantId),
          eq(trip.serviceDate, input.serviceDate),
          eq(trip.currentVehicleId, input.vehicleId),
          inArray(trip.state, [...IN_SERVICE_STATES]),
          ne(trip.id, input.tripId),
        ),
      );
    if (busyVehicle) {
      throw conflict('vehicle_in_use', 'Araç başka hazır veya canlı seferde');
    }
  }
  for (const membershipId of crewIds) {
    const [busyCrew] = await tx
      .select({ id: trip.id })
      .from(trip)
      .where(
        and(
          eq(trip.tenantId, input.tenantId),
          eq(trip.serviceDate, input.serviceDate),
          inArray(trip.state, [...IN_SERVICE_STATES]),
          ne(trip.id, input.tripId),
          or(
            eq(trip.currentDriverMembershipId, membershipId),
            eq(trip.currentAttendantMembershipId, membershipId),
          ),
        ),
      );
    if (busyCrew) {
      throw conflict('crew_in_use', 'Personel başka hazır veya canlı seferde');
    }
  }
}

async function tenantZone(tx: Database, tenantId: string): Promise<string> {
  const [row] = await tx
    .select({ timezone: tenant.timezone })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  return row?.timezone ?? 'Europe/Istanbul';
}

export function createOperationsPort(db: Database) {
  return {
    assignVehicle(
      tenantId: string,
      actor: TripActor,
      tripId: string,
      input: AssignTripVehicleInput,
    ): Promise<TripSummary> {
      return withOps(db, tenantId, actor.membershipId, async (tx) => {
        if (!actor.roles.includes('ADMIN')) throw forbidden();
        await lockTrip(tx, tenantId, tripId);
        const row = await loadTrip(tx, tenantId, tripId);
        assertOpenTrip(row.state);
        const [nextVehicle] = await tx
          .select({ id: vehicle.id, seatCount: vehicle.seatCount, plate: vehicle.plate })
          .from(vehicle)
          .where(and(eq(vehicle.id, input.vehicleId), eq(vehicle.tenantId, tenantId)));
        if (!nextVehicle) throw notFound('Araç bulunamadı');
        if (nextVehicle.id === row.vehicleId) {
          return toSummary(row, nextVehicle.plate, nextVehicle.id);
        }
        await assertCapacity(tx, tenantId, tripId, row.segment, nextVehicle.seatCount);
        await assertTripResourcesIdle(tx, {
          tenantId,
          tripId,
          serviceDate: row.serviceDate,
          vehicleId: nextVehicle.id,
        });
        const now = new Date();
        await tx
          .update(tripVehicleAssignment)
          .set({ validTo: now })
          .where(
            and(
              eq(tripVehicleAssignment.tenantId, tenantId),
              eq(tripVehicleAssignment.tripId, tripId),
              isNull(tripVehicleAssignment.validTo),
            ),
          );
        await tx.insert(tripVehicleAssignment).values({
          tenantId,
          tripId,
          vehicleId: nextVehicle.id,
          validFrom: now,
          reason: input.reason,
        });
        await tx
          .update(trip)
          .set({
            currentVehicleId: nextVehicle.id,
            locationSessionEpoch: row.locationSessionEpoch + 1,
            locationSourceDeviceId: null,
          })
          .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
        await invalidateTripLocation(tx, tenantId, tripId);
        await insertPlanEvent(tx, {
          tenantId,
          membershipId: actor.membershipId,
          role: 'ADMIN',
          tripId,
          vehicleId: nextVehicle.id,
          subjectType: 'TRIP',
          subjectId: tripId,
          eventType: 'VEHICLE_ASSIGNED',
          prevState: row.state,
          newState: row.state,
          payload: {
            fromVehicleId: row.vehicleId,
            toVehicleId: nextVehicle.id,
            reason: input.reason,
          },
        });
        if (row.state === 'ACTIVE') {
          await raiseCriticalAlert(tx, {
            tenantId,
            tripId,
            stopId: null,
            body: `Sefer aracı ${row.plate} yerine ${nextVehicle.plate} oldu`,
          });
        }
        return toSummary(row, nextVehicle.plate, nextVehicle.id);
      });
    },

    assignCrew(
      tenantId: string,
      actor: TripActor,
      tripId: string,
      input: AssignTripCrewInput,
    ): Promise<TripSummary> {
      return withOps(db, tenantId, actor.membershipId, async (tx) => {
        if (!actor.roles.includes('ADMIN')) throw forbidden();
        await lockTrip(tx, tenantId, tripId);
        const row = await loadTrip(tx, tenantId, tripId);
        assertOpenTrip(row.state);
        const [member] = await tx
          .select({ id: tenantMembership.id, status: tenantMembership.status })
          .from(tenantMembership)
          .where(
            and(
              eq(tenantMembership.id, input.membershipId),
              eq(tenantMembership.tenantId, tenantId),
            ),
          );
        if (!member || member.status !== 'ACTIVE') {
          throw notFound('Personel bulunamadı');
        }
        const [hasRole] = await tx
          .select({ role: membershipRole.role })
          .from(membershipRole)
          .where(
            and(
              eq(membershipRole.tenantId, tenantId),
              eq(membershipRole.membershipId, input.membershipId),
              eq(membershipRole.role, input.role),
            ),
          );
        if (!hasRole) throw conflict('role_mismatch', 'Bu üyede istenen personel rolü yok');
        if (input.role === 'DRIVER' && row.attendantId === input.membershipId) {
          throw conflict('role_conflict', 'Aynı kişi hem şoför hem hostes olamaz');
        }
        if (input.role === 'ATTENDANT' && row.driverId === input.membershipId) {
          throw conflict('role_conflict', 'Aynı kişi hem şoför hem hostes olamaz');
        }
        const current = input.role === 'DRIVER' ? row.driverId : row.attendantId;
        if (current === input.membershipId) return toSummary(row);
        await assertTripResourcesIdle(tx, {
          tenantId,
          tripId,
          serviceDate: row.serviceDate,
          membershipIds: [input.membershipId],
        });
        const nextDriver = input.role === 'DRIVER' ? input.membershipId : row.driverId;
        const nextAttendant = input.role === 'ATTENDANT' ? input.membershipId : row.attendantId;
        assertCrewComplete(row, nextDriver, nextAttendant);
        const now = new Date();
        await tx
          .update(tripCrewAssignment)
          .set({ validTo: now })
          .where(
            and(
              eq(tripCrewAssignment.tenantId, tenantId),
              eq(tripCrewAssignment.tripId, tripId),
              eq(tripCrewAssignment.role, input.role),
              isNull(tripCrewAssignment.validTo),
            ),
          );
        await tx.insert(tripCrewAssignment).values({
          tenantId,
          tripId,
          membershipId: input.membershipId,
          role: input.role,
          validFrom: now,
          reason: input.reason,
        });
        switch (input.role) {
          case 'DRIVER':
            await tx
              .update(trip)
              .set({
                currentDriverMembershipId: input.membershipId,
                locationSessionEpoch: row.locationSessionEpoch + 1,
                locationSourceDeviceId: null,
              })
              .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
            await invalidateTripLocation(tx, tenantId, tripId);
            break;
          case 'ATTENDANT':
            await tx
              .update(trip)
              .set({ currentAttendantMembershipId: input.membershipId })
              .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
            break;
          default:
            return exhaustive(input.role, 'assignCrew');
        }
        await insertPlanEvent(tx, {
          tenantId,
          membershipId: actor.membershipId,
          role: 'ADMIN',
          tripId,
          vehicleId: row.vehicleId,
          subjectType: 'TRIP',
          subjectId: tripId,
          eventType: 'CREW_ASSIGNED',
          prevState: row.state,
          newState: row.state,
          payload: { role: input.role, membershipId: input.membershipId, reason: input.reason },
        });
        if (row.state === 'ACTIVE') {
          await raiseCriticalAlert(tx, {
            tenantId,
            tripId,
            stopId: null,
            body:
              input.role === 'DRIVER'
                ? 'Sefer şoförü değişti; eski cihaz konumu düşer'
                : 'Sefer hostesi değişti',
          });
        }
        return toSummary(row);
      });
    },

    async transferStudent(
      tenantId: string,
      actor: TripActor,
      input: CreateStudentTripMoveInput,
    ): Promise<StudentTripMoveResult> {
      const outcome = await withOps(db, tenantId, actor.membershipId, async (tx) => {
        if (!actor.roles.includes('ADMIN')) throw forbidden();
        const zone = await tenantZone(tx, tenantId);
        const today = ymdInTimeZone(new Date(), zone);
        if (input.serviceDate < today)
          throw badRequest('past_date', 'Geçmiş gün için transfer yok');
        const [child] = await tx
          .select({
            id: student.id,
            fullName: student.fullName,
            schoolId: student.schoolId,
            usesMorning: student.usesMorning,
            usesEvening: student.usesEvening,
            suspended: student.suspended,
          })
          .from(student)
          .where(and(eq(student.id, input.studentId), eq(student.tenantId, tenantId)));
        if (!child) throw notFound('Öğrenci bulunamadı');
        if (child.suspended) throw conflict('student_suspended', 'Askıdaki öğrenci taşınamaz');
        if (input.segment === 'MORNING' && !child.usesMorning) {
          throw conflict('segment_unused', 'Öğrenci sabah servisini kullanmıyor');
        }
        if (input.segment === 'AFTERNOON' && !child.usesEvening) {
          throw conflict('segment_unused', 'Öğrenci akşam servisini kullanmıyor');
        }
        const [target] = await tx
          .select({
            id: route.id,
            schoolId: route.schoolId,
            segment: route.segment,
          })
          .from(route)
          .where(and(eq(route.id, input.targetRouteId), eq(route.tenantId, tenantId)));
        if (!target) throw notFound('Hedef rota bulunamadı');
        if (target.segment !== input.segment) {
          throw conflict('segment_mismatch', 'Hedef rota bu sefer dilimine ait değil');
        }
        if (target.schoolId !== child.schoolId) {
          throw conflict('student_wrong_school', 'Öğrenci bu okulun rotasına alınamaz');
        }
        const destRows = await tx
          .select({ id: trip.id, state: trip.state })
          .from(trip)
          .where(
            and(
              eq(trip.tenantId, tenantId),
              eq(trip.routeId, input.targetRouteId),
              eq(trip.serviceDate, input.serviceDate),
            ),
          );
        const destTrip = destRows.find((row) =>
          OPEN_TRIP_STATES.includes(row.state as (typeof OPEN_TRIP_STATES)[number]),
        );
        if (!destTrip) {
          throw conflict(
            destRows.length > 0 ? 'dest_trip_closed' : 'dest_trip_missing',
            destRows.length > 0
              ? 'Hedef sefer kapalı; transfer uygulanamaz'
              : 'Hedef sefer henüz yok; önce sefer üretin',
          );
        }
        const sources = await findOpenTripStudents(
          tx,
          tenantId,
          input.studentId,
          input.serviceDate,
          input.segment,
        );
        const idsToLock = [...new Set([destTrip.id, ...sources.map((item) => item.tripId)])]
          .filter((id): id is string => typeof id === 'string')
          .sort((a, b) => a.localeCompare(b));
        for (const id of idsToLock) await lockTrip(tx, tenantId, id);
        const lockedDest = await loadTrip(tx, tenantId, destTrip.id);
        if (!OPEN_TRIP_STATES.includes(lockedDest.state as (typeof OPEN_TRIP_STATES)[number])) {
          throw conflict('dest_trip_closed', 'Hedef sefer kapalı; transfer uygulanamaz');
        }

        const [existingMove] = await tx
          .select({ id: studentTripMove.id })
          .from(studentTripMove)
          .where(
            and(
              eq(studentTripMove.tenantId, tenantId),
              eq(studentTripMove.studentId, input.studentId),
              eq(studentTripMove.serviceDate, input.serviceDate),
              eq(studentTripMove.segment, input.segment),
            ),
          );
        if (existingMove) {
          throw conflict('move_exists', 'Bu gün ve sefer için zaten transfer var');
        }

        const lockedSources = await findOpenTripStudents(
          tx,
          tenantId,
          input.studentId,
          input.serviceDate,
          input.segment,
        );
        let source = lockedSources.find((item) => item.tripId !== destTrip.id) ?? null;
        if (!source && lockedSources[0] && lockedSources[0].tripId === destTrip.id) {
          throw conflict('same_route', 'Öğrenci zaten bu rotada');
        }
        source = source ?? lockedSources[0] ?? null;
        if (source) {
          const loaded = await loadTrip(tx, tenantId, source.tripId);
          if (loaded.routeId === input.targetRouteId) {
            throw conflict('same_route', 'Öğrenci zaten bu rotada');
          }
          const reconciled = reconcileStudent(source.studentState, 'STUDENT_TRIP_MOVE');
          switch (reconciled.kind) {
            case 'APPLY':
              break;
            case 'REJECT':
              throw conflict('student_on_board', 'Çocuk araçta; transfer yönetici kararına düşer');
            case 'FLAG_FOR_REVIEW':
              await applyTripStudentPlan(tx, {
                tripStudentId: source.tripStudentId,
                needsReview: true,
              });
              return { kind: 'needs_review' as const };
            case 'IGNORE':
              throw conflict('operational_fact', 'Operasyon gerçeği transferi ezmez');
            case 'APPLY_TARGET':
              throw conflict('illegal_transition', 'Transfer teslim hedefi değiştirmez');
            default:
              return exhaustive(reconciled, 'transferStudent');
          }
        }

        await tx.insert(studentTripMove).values({
          tenantId,
          studentId: input.studentId,
          serviceDate: input.serviceDate,
          segment: input.segment,
          targetRouteId: input.targetRouteId,
          reason: input.reason,
        });

        let sourceState: StudentState | null = source?.studentState ?? null;
        if (source) {
          const planned = await applyTripStudentPlan(tx, {
            tripStudentId: source.tripStudentId,
            state: 'MOVED_OUT',
          });
          if (!planned.applied) {
            if (planned.state === 'ON_BOARD') {
              throw conflict('student_on_board', 'Çocuk araçta; transfer yönetici kararına düşer');
            }
            throw conflict('operational_fact', 'Operasyon gerçeği transferi ezmez');
          }
          sourceState = 'MOVED_OUT';
          await insertPlanEvent(tx, {
            tenantId,
            membershipId: actor.membershipId,
            role: 'ADMIN',
            tripId: source.tripId,
            vehicleId: source.vehicleId,
            subjectType: 'TRIP_STUDENT',
            subjectId: source.tripStudentId,
            eventType: 'PLAN_MOVED_OUT',
            prevState: source.studentState,
            newState: 'MOVED_OUT',
            payload: { targetRouteId: input.targetRouteId, reason: input.reason },
          });
          if (source.tripState === 'ACTIVE') {
            await raiseCriticalAlert(tx, {
              tenantId,
              tripId: source.tripId,
              stopId: source.expectedStopId,
              body: `${child.fullName} bu seferden başka araca alındı`,
            });
            await refreshRoutesIfTripChanged(tx, tenantId, source.tripId);
          }
        }

        await insertMovedInStudent(tx, {
          tenantId,
          actorMembershipId: actor.membershipId,
          tripId: destTrip.id,
          studentId: input.studentId,
          studentName: child.fullName,
          segment: input.segment,
          counterpartId: source?.tripStudentId ?? null,
          serviceDate: input.serviceDate,
        });

        return {
          kind: 'ok' as const,
          value: {
            studentId: input.studentId,
            serviceDate: input.serviceDate,
            segment: input.segment,
            targetRouteId: input.targetRouteId,
            sourceTripId: source?.tripId ?? null,
            targetTripId: destTrip?.id ?? null,
            sourceState,
          },
        };
      });
      if (outcome.kind === 'needs_review') {
        throw conflict('needs_review', 'Saha gözlemiyle çelişiyor; transfer otomatik uygulanmaz');
      }
      return outcome.value;
    },

    listEvents(tenantId: string, membershipId: string, date: string): Promise<AdminEventsList> {
      return withOps(db, tenantId, membershipId, async (tx) => {
        const zone = await tenantZone(tx, tenantId);
        const start = zonedDayStart(date, zone);
        const end = zonedDayEnd(date, zone);
        const rows = await tx
          .select({
            seq: event.seq,
            occurredAt: event.occurredAtServer,
            eventType: event.eventType,
            subjectType: event.subjectType,
            subjectId: event.subjectId,
            tripId: event.tripId,
            prevState: event.prevState,
            newState: event.newState,
            actorRole: event.actorRole,
          })
          .from(event)
          .where(
            and(
              eq(event.tenantId, tenantId),
              gte(event.occurredAtServer, start),
              lt(event.occurredAtServer, end),
            ),
          )
          .orderBy(desc(event.occurredAtServer), desc(event.seq))
          .limit(LIST_LIMIT);
        const items = rows.map((row) => ({
          seq: row.seq,
          occurredAt: instantIso(row.occurredAt),
          eventType: row.eventType,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          tripId: row.tripId,
          prevState: row.prevState,
          newState: row.newState,
          actorRole: row.actorRole,
        }));
        return { available: true as const, items, csv: eventsToCsv(items) };
      });
    },

    listPriorities(
      tenantId: string,
      membershipId: string,
      date: string,
    ): Promise<AdminPrioritiesList> {
      return withOps(db, tenantId, membershipId, async (tx) => {
        const trips = await tx
          .select({
            id: trip.id,
            state: trip.state,
            plate: vehicle.plate,
            actualStartedAt: trip.actualStartedAt,
            vehicleId: trip.currentVehicleId,
            epoch: trip.locationSessionEpoch,
          })
          .from(trip)
          .innerJoin(
            vehicle,
            and(eq(vehicle.id, trip.currentVehicleId), eq(vehicle.tenantId, tenantId)),
          )
          .where(and(eq(trip.tenantId, tenantId), eq(trip.serviceDate, date)));
        const items: AdminPrioritiesList['items'] = [];
        const tripIds = trips.map((row) => row.id);
        const plateByTrip = new Map(trips.map((row) => [row.id, row.plate]));
        const lives =
          tripIds.length === 0
            ? []
            : await tx
                .select({
                  tripId: vehicleCurrentLocation.tripId,
                  vehicleId: vehicleCurrentLocation.vehicleId,
                  recordedAt: vehicleCurrentLocation.recordedAt,
                  sessionEpoch: vehicleCurrentLocation.sessionEpoch,
                  quality: vehicleCurrentLocation.quality,
                })
                .from(vehicleCurrentLocation)
                .where(
                  and(
                    eq(vehicleCurrentLocation.tenantId, tenantId),
                    inArray(vehicleCurrentLocation.tripId, tripIds),
                  ),
                );
        const liveByTrip = new Map(
          lives
            .filter((row) => row.quality !== 'REJECTED')
            .map((row) => [`${row.tripId}:${row.vehicleId}:${String(row.sessionEpoch)}`, row]),
        );

        for (const row of trips) {
          if (row.state !== 'ACTIVE') continue;
          const live = liveByTrip.get(`${row.id}:${row.vehicleId}:${String(row.epoch)}`);
          const ageMs = live
            ? Date.now() -
              (live.recordedAt instanceof Date
                ? live.recordedAt.getTime()
                : new Date(live.recordedAt).getTime())
            : row.actualStartedAt
              ? Date.now() -
                (row.actualStartedAt instanceof Date
                  ? row.actualStartedAt.getTime()
                  : new Date(row.actualStartedAt).getTime())
              : null;
          const watchdog = gpsWatchdog(ageMs);
          if (watchdog === 'UNAVAILABLE') {
            items.push({
              kind: 'GPS_STALE',
              severity: 'CRITICAL',
              tripId: row.id,
              plate: row.plate,
              body: `${row.plate}: araçtan 3 dakikadır konum alınamıyor`,
            });
          }
        }

        if (tripIds.length > 0) {
          const alerts = await tx
            .select({
              id: criticalChangeAlert.id,
              tripId: criticalChangeAlert.tripId,
              body: criticalChangeAlert.body,
            })
            .from(criticalChangeAlert)
            .where(
              and(
                eq(criticalChangeAlert.tenantId, tenantId),
                inArray(criticalChangeAlert.tripId, tripIds),
              ),
            );
          const alertIds = alerts.map((row) => row.id);
          const acks =
            alertIds.length === 0
              ? []
              : await tx
                  .select({ alertId: criticalChangeAck.alertId })
                  .from(criticalChangeAck)
                  .where(
                    and(
                      eq(criticalChangeAck.tenantId, tenantId),
                      inArray(criticalChangeAck.alertId, alertIds),
                    ),
                  );
          const acked = new Set(acks.map((row) => row.alertId));
          for (const alert of alerts) {
            if (acked.has(alert.id)) continue;
            items.push({
              kind: 'CRITICAL_UNACKED',
              severity: 'CRITICAL',
              tripId: alert.tripId,
              plate: plateByTrip.get(alert.tripId) ?? null,
              body: alert.body,
            });
          }

          const flagged = await tx
            .select({ tripId: tripStudent.tripId, fullName: student.fullName })
            .from(tripStudent)
            .innerJoin(
              student,
              and(eq(student.id, tripStudent.studentId), eq(student.tenantId, tenantId)),
            )
            .where(
              and(
                eq(tripStudent.tenantId, tenantId),
                inArray(tripStudent.tripId, tripIds),
                eq(tripStudent.needsReview, true),
              ),
            );
          for (const row of flagged) {
            items.push({
              kind: 'NEEDS_REVIEW',
              severity: 'WARNING',
              tripId: row.tripId,
              plate: plateByTrip.get(row.tripId) ?? null,
              body: `${row.fullName} saha çelişkisi — insan onayı`,
            });
          }
        }

        const overrides = await tx
          .select({
            status: deliveryOverride.status,
            studentName: student.fullName,
          })
          .from(deliveryOverride)
          .innerJoin(
            student,
            and(eq(student.id, deliveryOverride.studentId), eq(student.tenantId, tenantId)),
          )
          .where(
            and(
              eq(deliveryOverride.tenantId, tenantId),
              eq(deliveryOverride.serviceDate, date),
              inArray(deliveryOverride.status, ['LOCKED', 'PENDING_APPROVAL']),
            ),
          );
        for (const row of overrides) {
          if (row.status === 'LOCKED') {
            items.push({
              kind: 'OTP_LOCKED',
              severity: 'CRITICAL',
              tripId: null,
              plate: null,
              body: `${row.studentName}: teslim kodu kilitli`,
            });
          } else {
            items.push({
              kind: 'OVERRIDE_PENDING',
              severity: 'WARNING',
              tripId: null,
              plate: null,
              body: `${row.studentName}: farklı teslimat onay bekliyor`,
            });
          }
        }

        const rank = (kind: AdminPrioritiesList['items'][number]['kind']): number => {
          switch (kind) {
            case 'GPS_STALE':
              return 0;
            case 'OTP_LOCKED':
              return 1;
            case 'CRITICAL_UNACKED':
              return 2;
            case 'OVERRIDE_PENDING':
              return 3;
            case 'NEEDS_REVIEW':
              return 4;
            default: {
              const unexpected: never = kind;
              return unexpected;
            }
          }
        };
        items.sort((a, b) => rank(a.kind) - rank(b.kind));
        return { items };
      });
    },
  };
}

async function insertMovedInStudent(
  tx: Database,
  input: {
    tenantId: string;
    actorMembershipId: string;
    tripId: string;
    studentId: string;
    studentName: string;
    segment: 'MORNING' | 'AFTERNOON';
    counterpartId: string | null;
    serviceDate: string;
  },
): Promise<void> {
  const dest = await loadTrip(tx, input.tenantId, input.tripId);
  assertOpenTrip(dest.state);
  const [existing] = await tx
    .select({ id: tripStudent.id })
    .from(tripStudent)
    .where(
      and(
        eq(tripStudent.tenantId, input.tenantId),
        eq(tripStudent.tripId, input.tripId),
        eq(tripStudent.studentId, input.studentId),
      ),
    );
  if (existing) throw conflict('already_on_trip', 'Öğrenci hedef seferde zaten var');

  const stops = await tx
    .select({
      id: tripStop.id,
      seq: tripStop.seq,
      kind: tripStop.kind,
      lat: tripStop.snapshotLat,
      lng: tripStop.snapshotLng,
      text: tripStop.snapshotAddressText,
    })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, input.tripId), eq(tripStop.tenantId, input.tenantId)))
    .orderBy(asc(tripStop.seq));
  const home = await studentHomePoint(
    tx,
    input.tenantId,
    input.studentId,
    input.serviceDate,
    input.segment,
  );
  if (!home) throw conflict('student_address_missing', 'Öğrencinin bu sefer için adresi yok');
  const anchor = pickStudentAnchorStop(
    stops.map((row) => ({
      id: row.id,
      kind: row.kind,
      lat: row.lat,
      lng: row.lng,
      text: row.text,
    })),
    home,
    input.segment,
  );
  if (!anchor) {
    throw conflict(
      'stop_not_on_route',
      'Öğrencinin adresi hedef rotadaki bir durakla eşleşmiyor',
    );
  }
  const schoolStop = stops.find((row) => row.kind === 'SCHOOL');

  await assertCapacity(tx, input.tenantId, input.tripId, input.segment, dest.seatCount, {
    studentId: input.studentId,
    stopId: anchor.id,
  });

  await tx.insert(tripStopStudent).values({
    tenantId: input.tenantId,
    tripStopId: anchor.id,
    studentId: input.studentId,
  });

  let dropLat = anchor.lat;
  let dropLng = anchor.lng;
  let dropText = anchor.text;
  if (input.segment === 'MORNING') {
    if (!schoolStop) throw conflict('route_empty', 'Hedef seferde okul durağı yok');
    dropLat = schoolStop.lat;
    dropLng = schoolStop.lng;
    dropText = schoolStop.text;
  }
  let deliveryTarget: 'SCHOOL' | 'HOME' | 'TEMP' = deliveryTargetForSegment(input.segment);
  let receiverName: string | null = null;
  if (input.segment === 'AFTERNOON') {
    const [override] = await tx
      .select({
        receiverName: deliveryOverride.receiverName,
        lat: address.lat,
        lng: address.lng,
        text: address.text,
      })
      .from(deliveryOverride)
      .innerJoin(
        address,
        and(eq(address.id, deliveryOverride.addressId), eq(address.tenantId, input.tenantId)),
      )
      .where(
        and(
          eq(deliveryOverride.tenantId, input.tenantId),
          eq(deliveryOverride.studentId, input.studentId),
          eq(deliveryOverride.serviceDate, input.serviceDate),
          eq(deliveryOverride.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (override) {
      deliveryTarget = 'TEMP';
      receiverName = override.receiverName;
      dropLat = override.lat;
      dropLng = override.lng;
      dropText = override.text;
    }
  }

  const [created] = await tx
    .insert(tripStudent)
    .values({
      tenantId: input.tenantId,
      tripId: input.tripId,
      studentId: input.studentId,
      state: 'EXPECTED',
      deliveryTarget,
      expectedStopId: anchor.id,
      snapshotDropoffLat: dropLat,
      snapshotDropoffLng: dropLng,
      snapshotDropoffText: dropText,
      receiverName,
      origin: 'MOVED_IN',
      counterpartTripStudentId: input.counterpartId,
    })
    .returning({ id: tripStudent.id });
  if (!created) throw new HttpError(500, 'insert_failed', 'Hedef sefer satırı yazılamadı');

  await insertPlanEvent(tx, {
    tenantId: input.tenantId,
    membershipId: input.actorMembershipId,
    role: 'ADMIN',
    tripId: input.tripId,
    vehicleId: dest.vehicleId,
    subjectType: 'TRIP_STUDENT',
    subjectId: created.id,
    eventType: 'PLAN_MOVED_IN',
    prevState: null,
    newState: 'EXPECTED',
  });
  if (dest.state === 'ACTIVE') {
    await raiseCriticalAlert(tx, {
      tenantId: input.tenantId,
      tripId: input.tripId,
      stopId: anchor.id,
      body: `${input.studentName} bu sefere alındı`,
    });
    await refreshRoutesIfTripChanged(tx, input.tenantId, input.tripId);
  }
}
