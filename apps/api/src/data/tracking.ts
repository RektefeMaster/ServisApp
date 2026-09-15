import type {
  LocationIngestResult,
  LocationPingInput,
  ParentHome,
  ParentHomeChild,
  ParentLiveTrip,
  ParentTrackingView,
  VehicleBroadcast,
} from '@servisapp/contracts';
import {
  device,
  notification,
  platformSettings,
  routeSegmentStat,
  studentGuardian,
  tenant,
  tenantMembership,
  trip,
  tripStop,
  tripStudent,
  vehicleCurrentLocation,
  vehicleLocationPing,
  withTenant,
  type Database,
} from '@servisapp/db';
import {
  appendSegmentSample,
  blendSegmentSeconds,
  chunkedHaversineBaseline,
  delayFactor,
  distanceToPolylineM,
  etaConfidence,
  evaluateGpsQuality,
  formatParentEta,
  gpsAuthMessage,
  gpsRejectMessage,
  gpsWatchdog,
  gpsWatchdogParentMessage,
  haversineMeters,
  liveLocationAvailable,
  localTimeBucket,
  MAX_ROUTES_CALLS_PER_TRIP,
  parentCanTrack,
  planStopArrivals,
  remainingEtaSeconds,
  sharedTrackingPayload,
  shouldArchivePing,
  shouldNotifyApproach,
  shouldNotifyGuardian,
  shouldRefreshRoutes,
  studentStillTracked,
  summarizeSegmentSamples,
  ymdInTimeZone,
  type BaselineLeg,
  type GpsAuthReason,
  type ObservedLeg,
  type RouteBaseline,
} from '@servisapp/domain';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { gone, HttpError, notFound } from '../http-error.js';
import type { MemoryRealtimeTransport } from '../realtime/memory.js';
import { computeGoogleRouteBaseline } from './google-routes.js';
import { mapDbError } from './db-error.js';
import { loadParentChildren } from './plan-query.js';
import type { TripActor } from './ports.js';

const FAILOVER_MS = 60_000;

/** `date` kolonu sürücüye göre string ya da Date gelebilir; ikisini de kabul et. */
function ymdOf(value: string | Date): string {
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}

export interface TrackingPort {
  ingest(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: LocationPingInput,
  ): Promise<LocationIngestResult>;
  pollForParent(
    tenantId: string,
    membershipId: string,
    tripId: string,
    studentId?: string,
  ): Promise<ParentTrackingView>;
  homeForParent(tenantId: string, membershipId: string): Promise<ParentHome>;
  realtime: MemoryRealtimeTransport;
}

export function createTrackingPort(db: Database, realtime: MemoryRealtimeTransport): TrackingPort {
  /** Transaction kapandıktan sonraki iş; yanıtın tipini değiştirmez. */
  const afterCommit = async <T>(result: T): Promise<T> => {
    await drainBaselineRefines(db);
    return result;
  };
  return {
    realtime,
    ingest(tenantId, actor, tripId, input) {
      const run = async (tx: Database): Promise<LocationIngestResult> => {
        const [platform] = await tx
          .select({
            killGps: platformSettings.killGps,
            killRealtime: platformSettings.killRealtime,
          })
          .from(platformSettings)
          .where(eq(platformSettings.id, true));
        if (platform?.killGps) {
          throw authConflict('GPS_KILLED');
        }
        const deviceId = actor.deviceId;
        if (!deviceId) throw authConflict('WRONG_DEVICE');
        const [deviceRow] = await tx
          .select({ membershipId: device.membershipId, revokedAt: device.revokedAt })
          .from(device)
          .where(and(eq(device.id, deviceId), eq(device.tenantId, tenantId)));
        if (!deviceRow || deviceRow.revokedAt) throw authConflict('DEVICE_REVOKED');
        if (deviceRow.membershipId !== actor.membershipId) throw authConflict('WRONG_DEVICE');

        const [row] = await tx
          .select({
            id: trip.id,
            state: trip.state,
            vehicleId: trip.currentVehicleId,
            driverId: trip.currentDriverMembershipId,
            attendantId: trip.currentAttendantMembershipId,
            sourceDeviceId: trip.locationSourceDeviceId,
            sessionEpoch: trip.locationSessionEpoch,
            startedAt: trip.actualStartedAt,
            routeId: trip.routeId,
            plannedDepartureAt: trip.plannedDepartureAt,
            routeBaseline: trip.routeBaseline,
            routesCallsCount: trip.routesCallsCount,
            lastRoutesCallAt: trip.lastRoutesCallAt,
          })
          .from(trip)
          .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)))
          .for('update');
        if (!row) throw authConflict('WRONG_TRIP');
        if (row.state !== 'ACTIVE') throw authConflict('TRIP_NOT_ACTIVE');
        const assigned =
          actor.membershipId === row.driverId || actor.membershipId === row.attendantId;
        if (!assigned) throw authConflict('WRONG_DEVICE');

        const now = new Date();
        const nowMs = now.getTime();
        const [current] = await tx
          .select()
          .from(vehicleCurrentLocation)
          .where(
            and(
              eq(vehicleCurrentLocation.tenantId, tenantId),
              eq(vehicleCurrentLocation.vehicleId, row.vehicleId),
            ),
          )
          .for('update');

        let sessionEpoch = row.sessionEpoch;
        let sourceDeviceId = row.sourceDeviceId;
        const lastHeardMs = current?.receivedAt.getTime() ?? row.startedAt?.getTime() ?? nowMs;
        const silenceMs = nowMs - lastHeardMs;
        const foreignDevice = deviceId !== sourceDeviceId;
        if (foreignDevice) {
          const canFailover = sourceDeviceId === null || silenceMs >= FAILOVER_MS;
          if (!canFailover) throw authConflict('WRONG_DEVICE');
        } else if (input.sessionEpoch !== row.sessionEpoch) {
          throw authConflict('WRONG_EPOCH');
        }

        const recordedAt = new Date(input.recordedAt);
        const lastGood =
          current && current.quality !== 'REJECTED'
            ? {
                lat: current.lat,
                lng: current.lng,
                recordedAtMs: current.recordedAt.getTime(),
              }
            : null;
        const verdict = evaluateGpsQuality({
          nowMs,
          sample: {
            lat: input.lat,
            lng: input.lng,
            accuracyM: input.accuracyM ?? null,
            speedMps: input.speedMps ?? null,
            recordedAtMs: recordedAt.getTime(),
          },
          lastGood,
        });

        if (verdict.quality === 'REJECTED') {
          return {
            accepted: false,
            quality: 'REJECTED',
            reason: gpsRejectMessage(verdict.reason),
            liveAvailable: liveLocationAvailable(
              gpsWatchdog(current ? nowMs - current.recordedAt.getTime() : null),
              false,
            ),
            sessionEpoch: row.sessionEpoch,
            locationSourceDeviceId: row.sourceDeviceId,
            trackingEnded: false,
          };
        }

        if (foreignDevice) {
          sessionEpoch = row.sessionEpoch + 1;
          sourceDeviceId = deviceId;
          await tx
            .update(trip)
            .set({ locationSourceDeviceId: deviceId, locationSessionEpoch: sessionEpoch })
            .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
        }

        const quality = verdict.quality;
        await tx
          .insert(vehicleCurrentLocation)
          .values({
            tenantId,
            vehicleId: row.vehicleId,
            tripId,
            lat: input.lat,
            lng: input.lng,
            speed: input.speedMps ?? null,
            heading: input.heading ?? null,
            accuracyM: input.accuracyM ?? null,
            recordedAt,
            receivedAt: now,
            sourceDeviceId: deviceId,
            sessionEpoch,
            quality,
            isStale: false,
          })
          .onConflictDoUpdate({
            target: [vehicleCurrentLocation.tenantId, vehicleCurrentLocation.vehicleId],
            set: {
              tripId,
              lat: input.lat,
              lng: input.lng,
              speed: input.speedMps ?? null,
              heading: input.heading ?? null,
              accuracyM: input.accuracyM ?? null,
              recordedAt,
              receivedAt: now,
              sourceDeviceId: deviceId,
              sessionEpoch,
              quality,
              isStale: false,
            },
          });

        const lastArchive = current?.receivedAt.getTime() ?? null;
        if (shouldArchivePing(lastArchive, nowMs)) {
          await tx.insert(vehicleLocationPing).values({
            tenantId,
            vehicleId: row.vehicleId,
            tripId,
            lat: input.lat,
            lng: input.lng,
            speed: input.speedMps ?? null,
            heading: input.heading ?? null,
            accuracyM: input.accuracyM ?? null,
            recordedAt,
            receivedAt: now,
            sourceDeviceId: deviceId,
            sessionEpoch,
            quality,
          });
        }

        const broadcast: VehicleBroadcast = sharedTrackingPayload({
          vehicleLat: input.lat,
          vehicleLng: input.lng,
          heading: input.heading ?? null,
          recordedAt: recordedAt.toISOString().replace(/Z$/, '+00:00'),
          quality,
        });
        if (!platform?.killRealtime) {
          realtime.publishVehicle(tripId, broadcast);
        }

        await markSequentialArrivals(tx, {
          tenantId,
          tripId,
          routeId: row.routeId,
          vehicle: { lat: input.lat, lng: input.lng },
          now,
        });

        const etaContext = await refreshStudentEtas(tx, {
          tenantId,
          tripId,
          routeId: row.routeId,
          plannedDepartureAt: row.plannedDepartureAt,
          vehicle: { lat: input.lat, lng: input.lng },
          accuracyM: input.accuracyM ?? null,
          recordedAtMs: recordedAt.getTime(),
          now,
          baseline: asBaseline(row.routeBaseline),
        });

        if (
          shouldRefreshRoutes({
            nowMs,
            lastRoutesCallAtMs: row.lastRoutesCallAt?.getTime() ?? null,
            routesCallsCount: row.routesCallsCount,
            offRouteM: etaContext.offRouteM,
            unexpectedStopMs: await unexpectedDwellMs(
              tx,
              tenantId,
              tripId,
              { lat: input.lat, lng: input.lng },
              nowMs,
            ),
            etaConfidence: etaContext.sampleConfidence,
            routeChanged: false,
            seriousEtaMiss: etaContext.delayFactor > 1.6 || etaContext.delayFactor < 0.7,
          })
        ) {
          await writeBaseline(tx, tenantId, tripId, { force: true });
          await requestBaselineRefine(tx, tenantId, tripId);
        }

        return {
          accepted: true,
          quality,
          liveAvailable: true,
          sessionEpoch,
          locationSourceDeviceId: sourceDeviceId,
          trackingEnded: false,
        };
        // Google iyileştirmesi transaction KAPANDIKTAN sonra (afterCommit).
      };
      return withTracking(db, tenantId, actor.membershipId, crewRole(actor), run).then(afterCommit);
    },

    pollForParent(tenantId, membershipId, tripId, studentId) {
      return withTracking(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        const live = await loadParentTripView(tx, tenantId, membershipId, tripId, studentId);
        if (!live) throw notFound('Sefer bulunamadı');
        if (live.trackingEnded) {
          realtime.dropViewer(tripId, membershipId);
          throw gone('tracking_ended', 'Canlı takip kapandı');
        }
        realtime.rememberViewer(tripId, membershipId);
        return toTrackingView(live);
      });
    },

    homeForParent(tenantId, membershipId) {
      return withTracking(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        const [membership] = await tx
          .select({ status: tenantMembership.status })
          .from(tenantMembership)
          .where(
            and(eq(tenantMembership.id, membershipId), eq(tenantMembership.tenantId, tenantId)),
          );
        if (!membership) return { children: [] };
        const children = await loadParentChildren(tx, tenantId, membershipId, membership.status);
        const items: ParentHomeChild[] = [];
        for (const child of children) {
          const live = await loadChildLive(tx, tenantId, membershipId, child.studentId);
          // Biten sefer de gönderilir: `trackingEnded` işaretiyle gelir, canlı
          // takip açmaz, ama günün sonucunu ekranda tutar.
          items.push({ ...child, live, day: null });
        }
        return { children: items };
      });
    },
  };
}

function crewRole(actor: TripActor): string {
  if (actor.roles.includes('ADMIN')) return 'ADMIN';
  if (actor.roles.includes('DRIVER')) return 'DRIVER';
  if (actor.roles.includes('ATTENDANT')) return 'ATTENDANT';
  return 'DRIVER';
}

function authConflict(reason: GpsAuthReason): HttpError {
  return new HttpError(409, reason.toLowerCase(), gpsAuthMessage(reason));
}

async function withTracking<T>(
  db: Database,
  tenantId: string,
  membershipId: string | null,
  role: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await withTenant(db, { tenantId, membershipId, role }, fn);
  } catch (error) {
    mapDbError(error);
  }
}

function asBaseline(value: unknown): RouteBaseline | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { source?: unknown; computedAt?: unknown; legs?: unknown };
  if (record.source !== 'google' && record.source !== 'haversine') return null;
  if (typeof record.computedAt !== 'string' || !Array.isArray(record.legs)) return null;
  const legs: BaselineLeg[] = [];
  for (const item of record.legs) {
    if (!item || typeof item !== 'object') continue;
    const leg = item as Record<string, unknown>;
    if (
      typeof leg['fromStopId'] !== 'string' ||
      typeof leg['toStopId'] !== 'string' ||
      typeof leg['durationSec'] !== 'number' ||
      typeof leg['distanceM'] !== 'number'
    ) {
      continue;
    }
    legs.push({
      fromStopId: leg['fromStopId'],
      toStopId: leg['toStopId'],
      durationSec: leg['durationSec'],
      distanceM: leg['distanceM'],
    });
  }
  return { source: record.source, computedAt: record.computedAt, legs };
}

async function refreshStudentEtas(
  tx: Database,
  input: {
    tenantId: string;
    tripId: string;
    routeId: string;
    plannedDepartureAt: Date;
    vehicle: { lat: number; lng: number };
    accuracyM: number | null;
    recordedAtMs: number;
    now: Date;
    baseline: RouteBaseline | null;
  },
): Promise<{ offRouteM: number | null; sampleConfidence: number; delayFactor: number }> {
  const stops = await tx
    .select({
      id: tripStop.id,
      seq: tripStop.seq,
      lat: tripStop.snapshotLat,
      lng: tripStop.snapshotLng,
      arrivedAt: tripStop.actualArrivedAt,
    })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, input.tripId), eq(tripStop.tenantId, input.tenantId)))
    .orderBy(asc(tripStop.seq));
  const etaStops = stops.map((stop) => ({
    id: stop.id,
    seq: Number(stop.seq),
    lat: stop.lat,
    lng: stop.lng,
  }));
  // Varışı kaydedilmiş son durak rota ilerleyişinin zeminidir; ETA bunun
  // gerisine sarmaz (yol kıvrımında geçilmiş durağa yeniden yaklaşmak gibi).
  const lastArrivedSeq = stops.reduce<number | null>(
    (acc, stop) =>
      stop.arrivedAt ? Math.max(acc ?? Number.NEGATIVE_INFINITY, Number(stop.seq)) : acc,
    null,
  );
  const observed: ObservedLeg[] = [];
  const legs = await blendBaselineLegs(
    tx,
    input.tenantId,
    input.tripId,
    input.routeId,
    input.plannedDepartureAt,
    input.baseline?.legs ?? [],
  );
  for (let i = 0; i < stops.length - 1; i += 1) {
    const from = stops[i];
    const to = stops[i + 1];
    if (!from?.arrivedAt || !to?.arrivedAt) continue;
    observed.push({
      fromStopId: from.id,
      toStopId: to.id,
      actualDurationSec: Math.max(
        1,
        Math.round((to.arrivedAt.getTime() - from.arrivedAt.getTime()) / 1000),
      ),
    });
  }
  const factor = delayFactor(legs, observed);
  const offRouteRaw = distanceToPolylineM(
    input.vehicle,
    etaStops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
  );
  const offRouteM = Number.isFinite(offRouteRaw) ? offRouteRaw : null;
  const students = await tx
    .select({
      id: tripStudent.id,
      studentId: tripStudent.studentId,
      state: tripStudent.state,
      expectedStopId: tripStudent.expectedStopId,
      etaSeconds: tripStudent.etaSeconds,
      approachNotifiedAt: tripStudent.approachNotifiedAt,
    })
    .from(tripStudent)
    .where(and(eq(tripStudent.tripId, input.tripId), eq(tripStudent.tenantId, input.tenantId)));

  const threshold = await approachThreshold(tx, input.tenantId);
  const sampleConfidence = etaConfidence({
    gpsAgeMs: input.now.getTime() - input.recordedAtMs,
    accuracyM: input.accuracyM,
    offRouteM,
    hasBaseline: Boolean(input.baseline),
    delayFactor: factor,
  });

  // Önce hesapla, sonra TEK ifadeyle yaz: ping başına öğrenci sayısı kadar
  // gidiş-dönüş, en sıcak yolun en pahalı kısmıydı (bkz. 0039).
  const updates: Array<{
    trip_student_id: string;
    eta_seconds: number;
    approach_notified_at: string | null;
  }> = [];
  const notifyStudentIds: string[] = [];
  for (const student of students) {
    if (!studentStillTracked(student.state)) continue;
    if (!student.expectedStopId) continue;
    const etaSeconds = remainingEtaSeconds({
      vehicle: input.vehicle,
      stops: etaStops,
      targetStopId: student.expectedStopId,
      legs,
      observed,
      lastArrivedSeq,
    });
    const notify = shouldNotifyApproach({
      etaSeconds,
      previousEtaSeconds: student.etaSeconds,
      approachNotifiedAt: student.approachNotifiedAt?.toISOString() ?? null,
      thresholdMinutes: threshold,
    });
    const approachAt = notify ? input.now : student.approachNotifiedAt;
    updates.push({
      trip_student_id: student.id,
      eta_seconds: etaSeconds,
      approach_notified_at: approachAt ? approachAt.toISOString() : null,
    });
    if (notify) notifyStudentIds.push(student.studentId);
  }

  if (updates.length > 0) {
    await tx.execute(sql`
      select update_trip_student_tracking_batch(
        ${JSON.stringify(updates)}::jsonb,
        ${sampleConfidence}::real,
        ${input.now.toISOString()}::timestamptz
      )
    `);
  }
  for (const studentId of notifyStudentIds) {
    await queueApproachNotifications(tx, input.tenantId, input.tripId, studentId);
  }
  return { offRouteM, sampleConfidence, delayFactor: factor };
}

/**
 * Öğrenilmiş süreleri baseline'a harmanlar.
 *
 * Kova seçimi seferin kalkış saatine değil, SEGMENTİN KENDİ geçiş saatine göre
 * yapılır. 07:00'de çıkan araç son segmente 08:05'te varıyorsa o segmenti
 * "07:00 trafiği" diye öğrenmek yanlıştı. Yazma tarafı bacağın gerçek başlangıç
 * anını, okuma tarafı baseline üzerinden tahmini başlangıç anını kullanır —
 * ikisi de aynı şeyi sorar.
 */
async function blendBaselineLegs(
  tx: Database,
  tenantId: string,
  tripId: string,
  routeId: string,
  plannedDepartureAt: Date,
  legs: readonly BaselineLeg[],
): Promise<BaselineLeg[]> {
  if (legs.length === 0) return [];
  const timeZone = await tenantTimeZone(tx, tenantId);
  let cursorMs = plannedDepartureAt.getTime();
  const legBuckets = legs.map((leg) => {
    const bucket = localTimeBucket(new Date(cursorMs), timeZone);
    cursorMs += Math.max(0, leg.durationSec) * 1000;
    return bucket;
  });
  const weekdays = [...new Set(legBuckets.map((item) => item.weekday))];
  const hours = [...new Set(legBuckets.map((item) => item.hour))];
  const stats = await tx
    .select({
      fromStopId: routeSegmentStat.fromStopId,
      toStopId: routeSegmentStat.toStopId,
      weekday: routeSegmentStat.weekday,
      timeBucket: routeSegmentStat.timeBucket,
      sampleCount: routeSegmentStat.sampleCount,
      medianSeconds: routeSegmentStat.medianSeconds,
    })
    .from(routeSegmentStat)
    .where(
      and(
        eq(routeSegmentStat.tenantId, tenantId),
        eq(routeSegmentStat.routeId, routeId),
        inArray(routeSegmentStat.weekday, weekdays),
        inArray(routeSegmentStat.timeBucket, hours),
      ),
    );
  const byKey = new Map(
    stats.map(
      (row) =>
        [
          `${row.fromStopId}:${row.toStopId}:${String(row.weekday)}:${String(row.timeBucket)}`,
          row,
        ] as const,
    ),
  );
  const tripStops = await tx
    .select({ id: tripStop.id, sourceStopId: tripStop.sourceStopId })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, tripId), eq(tripStop.tenantId, tenantId)));
  const sourceOf = new Map(tripStops.map((row) => [row.id, row.sourceStopId]));
  return legs.map((leg, index) => {
    const bucket = legBuckets[index];
    const fromSource = sourceOf.get(leg.fromStopId);
    const toSource = sourceOf.get(leg.toStopId);
    const stat =
      fromSource && toSource && bucket
        ? byKey.get(`${fromSource}:${toSource}:${String(bucket.weekday)}:${String(bucket.hour)}`)
        : undefined;
    return {
      ...leg,
      durationSec: blendSegmentSeconds(
        leg.durationSec,
        stat?.sampleCount ?? 0,
        stat?.medianSeconds ?? null,
      ),
    };
  });
}

/**
 * Trafik dilimi kiracının yerel saatinden okunur. UTC saatiyle kovalamak
 * "sabah 07:00" verisini 04:00 kovasına yazıyordu; çok saat dilimli kurulumda
 * da kovalar birbirine karışırdı.
 */
async function tenantTimeZone(tx: Database, tenantId: string): Promise<string> {
  const [row] = await tx
    .select({ timezone: tenant.timezone })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  return row?.timezone ?? 'Europe/Istanbul';
}

async function unexpectedDwellMs(
  tx: Database,
  tenantId: string,
  tripId: string,
  vehicle: { lat: number; lng: number },
  nowMs: number,
): Promise<number | null> {
  const stops = await tx
    .select({ lat: tripStop.snapshotLat, lng: tripStop.snapshotLng })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, tripId), eq(tripStop.tenantId, tenantId)));
  if (stops.length === 0) return null;
  const nearest = Math.min(
    ...stops.map((stop) => haversineMeters(vehicle, { lat: stop.lat, lng: stop.lng })),
  );
  if (nearest <= 75) return null;
  const pings = await tx
    .select({
      lat: vehicleLocationPing.lat,
      lng: vehicleLocationPing.lng,
      recordedAt: vehicleLocationPing.recordedAt,
    })
    .from(vehicleLocationPing)
    .where(and(eq(vehicleLocationPing.tripId, tripId), eq(vehicleLocationPing.tenantId, tenantId)))
    .orderBy(desc(vehicleLocationPing.receivedAt))
    .limit(16);
  const cluster = pings.filter((ping) => haversineMeters(vehicle, ping) < 35);
  if (cluster.length < 2) return null;
  const oldest = Math.min(...cluster.map((ping) => ping.recordedAt.getTime()));
  return Math.max(0, nowMs - oldest);
}

async function markSequentialArrivals(
  tx: Database,
  input: {
    tenantId: string;
    tripId: string;
    routeId: string;
    vehicle: { lat: number; lng: number };
    now: Date;
  },
): Promise<void> {
  const stops = await tx
    .select({
      id: tripStop.id,
      seq: tripStop.seq,
      lat: tripStop.snapshotLat,
      lng: tripStop.snapshotLng,
      arrivedAt: tripStop.actualArrivedAt,
      sourceStopId: tripStop.sourceStopId,
    })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, input.tripId), eq(tripStop.tenantId, input.tenantId)))
    .orderBy(asc(tripStop.seq));
  const marks = planStopArrivals(
    stops.map((stop) => ({
      id: stop.id,
      seq: Number(stop.seq),
      lat: stop.lat,
      lng: stop.lng,
      arrivedAt: stop.arrivedAt,
    })),
    input.vehicle,
  );
  if (marks.length === 0) return;

  const byId = new Map(stops.map((stop) => [stop.id, stop] as const));
  const timeZone = await tenantTimeZone(tx, input.tenantId);
  for (const mark of marks) {
    const current = byId.get(mark.stopId);
    if (!current || current.arrivedAt) continue;
    await tx
      .update(tripStop)
      .set({ actualArrivedAt: input.now })
      .where(and(eq(tripStop.id, current.id), eq(tripStop.tenantId, input.tenantId)));
    current.arrivedAt = input.now;
    if (mark.kind === 'MISSED') continue;
    const previous = [...stops]
      .reverse()
      .find(
        (stop) =>
          stop.arrivedAt && Number(stop.seq) < Number(current.seq) && stop.id !== current.id,
      );
    if (!previous?.sourceStopId || !current.sourceStopId || !previous.arrivedAt) continue;
    const actualSec = Math.max(
      1,
      Math.round((input.now.getTime() - previous.arrivedAt.getTime()) / 1000),
    );
    // Bacağın kovası, bacağın BAŞLADIĞI andır (önceki durağa varış).
    const bucket = localTimeBucket(previous.arrivedAt, timeZone);
    const [existing] = await tx
      .select({
        sampleCount: routeSegmentStat.sampleCount,
        recentSeconds: routeSegmentStat.recentSeconds,
      })
      .from(routeSegmentStat)
      .where(
        and(
          eq(routeSegmentStat.tenantId, input.tenantId),
          eq(routeSegmentStat.routeId, input.routeId),
          eq(routeSegmentStat.fromStopId, previous.sourceStopId),
          eq(routeSegmentStat.toStopId, current.sourceStopId),
          eq(routeSegmentStat.weekday, bucket.weekday),
          eq(routeSegmentStat.timeBucket, bucket.hour),
        ),
      );
    const samples = appendSegmentSample(existing?.recentSeconds ?? [], actualSec);
    const summary = summarizeSegmentSamples(samples);
    if (!summary) continue;
    await tx
      .insert(routeSegmentStat)
      .values({
        tenantId: input.tenantId,
        routeId: input.routeId,
        fromStopId: previous.sourceStopId,
        toStopId: current.sourceStopId,
        weekday: bucket.weekday,
        timeBucket: bucket.hour,
        sampleCount: 1,
        recentSeconds: samples,
        avgSeconds: summary.avgSeconds,
        medianSeconds: summary.medianSeconds,
        p75Seconds: summary.p75Seconds,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          routeSegmentStat.tenantId,
          routeSegmentStat.routeId,
          routeSegmentStat.fromStopId,
          routeSegmentStat.toStopId,
          routeSegmentStat.weekday,
          routeSegmentStat.timeBucket,
        ],
        set: {
          // sampleCount ömürlük deneyimdir (harmanlama ağırlığı); medyan ve p75
          // ise yalnız son N ölçümün penceresinden gelir.
          sampleCount: sql`${routeSegmentStat.sampleCount} + 1`,
          recentSeconds: samples,
          avgSeconds: summary.avgSeconds,
          medianSeconds: summary.medianSeconds,
          p75Seconds: summary.p75Seconds,
          updatedAt: input.now,
        },
      });
  }
}

function approachMinutes(settings: unknown): number {
  if (!settings || typeof settings !== 'object') return 5;
  const value = (settings as { approachNotificationMinutes?: unknown }).approachNotificationMinutes;
  return typeof value === 'number' && value > 0 && value < 30 ? value : 5;
}

/**
 * "Yaklaşıyor" eşiği her GPS ping'inde `tenant` tablosundan yeniden okunuyordu.
 * Değer saatte bir bile değişmiyor; platform kill switch'i ile aynı gerekçe ve
 * aynı pencere: en geç 5 saniyede sahaya yayılır (SPEC §12).
 */
const APPROACH_CACHE_MS = process.env['NODE_ENV'] === 'test' ? 0 : 5_000;
const approachCache = new Map<string, { minutes: number; expiresAt: number }>();

async function approachThreshold(tx: Database, tenantId: string): Promise<number> {
  const hit = approachCache.get(tenantId);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.minutes;
  const [row] = await tx
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const minutes = approachMinutes(row?.settings);
  approachCache.set(tenantId, { minutes, expiresAt: now + APPROACH_CACHE_MS });
  return minutes;
}

async function queueApproachNotifications(
  tx: Database,
  tenantId: string,
  tripId: string,
  studentId: string,
): Promise<void> {
  const [tripRow] = await tx
    .select({ segment: trip.segment })
    .from(trip)
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  const segment = tripRow?.segment === 'AFTERNOON' ? 'AFTERNOON' : 'MORNING';
  const guardians = await tx
    .select({
      membershipId: studentGuardian.guardianMembershipId,
      notifyAm: studentGuardian.notifyAm,
      notifyPm: studentGuardian.notifyPm,
    })
    .from(studentGuardian)
    .innerJoin(
      tenantMembership,
      and(
        eq(tenantMembership.id, studentGuardian.guardianMembershipId),
        eq(tenantMembership.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(studentGuardian.tenantId, tenantId),
        eq(studentGuardian.studentId, studentId),
        eq(studentGuardian.status, 'ACTIVE'),
        // İlişki açık olsa da üyeliği kapatılmış kişiye bildirim gitmez.
        inArray(tenantMembership.status, ['ACTIVE', 'INVITED']),
      ),
    );
  for (const guardian of guardians) {
    if (
      !shouldNotifyGuardian({
        relationActive: true,
        notifyAm: guardian.notifyAm,
        notifyPm: guardian.notifyPm,
        segment,
      })
    ) {
      continue;
    }
    await tx
      .insert(notification)
      .values({
        tenantId,
        recipientMembershipId: guardian.membershipId,
        channel: 'PUSH',
        type: 'APPROACH',
        tripId,
        studentId,
        status: 'QUEUED',
        dedupeKey: `approach:${tripId}:${studentId}:${guardian.membershipId}`,
      })
      .onConflictDoNothing();
  }
}

async function loadChildLive(
  tx: Database,
  tenantId: string,
  membershipId: string,
  studentId: string,
): Promise<ParentLiveTrip | null> {
  const rows = await tx
    .select({
      tripId: trip.id,
      segment: trip.segment,
      tripState: trip.state,
      studentState: tripStudent.state,
      serviceDate: trip.serviceDate,
      startedAt: trip.actualStartedAt,
    })
    .from(tripStudent)
    .innerJoin(trip, and(eq(trip.id, tripStudent.tripId), eq(trip.tenantId, tenantId)))
    .where(and(eq(tripStudent.tenantId, tenantId), eq(tripStudent.studentId, studentId)))
    .orderBy(desc(trip.serviceDate), desc(trip.actualStartedAt));
  const active = rows.find((row) => row.tripState === 'ACTIVE');
  if (active) return loadParentTripView(tx, tenantId, membershipId, active.tripId, studentId);

  /**
   * Sefer kapanınca ekran günün sonucunu UNUTUYORDU: çocuk 17:40'ta teslim
   * edilmiş olsa bile kart akşam boyunca "Servis planlı" yazıyordu, çünkü
   * canlı görünüm yalnız ACTIVE sefere bakıyordu. Velinin sorusu ise
   * kapandıktan sonra da aynı: "çocuğum indi mi?". Bugünün BAŞLAMIŞ son
   * seferini döndürüyoruz; görünüm `trackingEnded` ile işaretli gelir, yani
   * canlı takip açılmaz, yalnız sonuç okunur.
   */
  const [tenantRow] = await tx
    .select({ timezone: tenant.timezone })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const today = ymdInTimeZone(new Date(), tenantRow?.timezone ?? 'Europe/Istanbul');
  const finished = rows
    .filter((row) => ymdOf(row.serviceDate) === today && row.startedAt !== null)
    .sort((left, right) => (right.startedAt?.getTime() ?? 0) - (left.startedAt?.getTime() ?? 0))[0];
  if (!finished) return null;
  return loadParentTripView(tx, tenantId, membershipId, finished.tripId, studentId);
}

function toTrackingView(live: ParentLiveTrip): ParentTrackingView {
  return {
    tripId: live.tripId,
    studentId: live.studentId,
    vehicle: live.vehicle,
    liveAvailable: live.liveAvailable,
    staleMessage: live.staleMessage,
    ownStop: live.ownStop,
    etaText: live.etaText,
    approaching: live.approaching,
    trackingEnded: live.trackingEnded,
  };
}

async function loadParentTripView(
  tx: Database,
  tenantId: string,
  membershipId: string,
  tripId: string,
  onlyStudentId?: string,
): Promise<ParentLiveTrip | null> {
  const [membership] = await tx
    .select({ status: tenantMembership.status })
    .from(tenantMembership)
    .where(and(eq(tenantMembership.id, membershipId), eq(tenantMembership.tenantId, tenantId)));
  if (!membership || membership.status !== 'ACTIVE') return null;

  const [tripRow] = await tx
    .select({
      id: trip.id,
      state: trip.state,
      vehicleId: trip.currentVehicleId,
      segment: trip.segment,
      locationSessionEpoch: trip.locationSessionEpoch,
    })
    .from(trip)
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  if (!tripRow) return null;

  const students = await tx
    .select({
      studentId: tripStudent.studentId,
      state: tripStudent.state,
      expectedStopId: tripStudent.expectedStopId,
      etaSeconds: tripStudent.etaSeconds,
      etaConfidence: tripStudent.etaConfidence,
      approachNotifiedAt: tripStudent.approachNotifiedAt,
      relationStatus: studentGuardian.status,
    })
    .from(tripStudent)
    .innerJoin(
      studentGuardian,
      and(
        eq(studentGuardian.studentId, tripStudent.studentId),
        eq(studentGuardian.tenantId, tenantId),
        eq(studentGuardian.guardianMembershipId, membershipId),
        eq(studentGuardian.status, 'ACTIVE'),
      ),
    )
    .where(and(eq(tripStudent.tripId, tripId), eq(tripStudent.tenantId, tenantId)));

  const mine = students.filter((row) => (onlyStudentId ? row.studentId === onlyStudentId : true));
  const trackable = mine.find((row) =>
    parentCanTrack({
      membershipStatus: membership.status,
      guardianRelationActive: row.relationStatus === 'ACTIVE',
      tripState: tripRow.state,
      studentState: row.state,
    }),
  );
  if (!trackable) {
    const endedStudent = mine[0];
    if (tripRow.state !== 'ACTIVE' || mine.some((row) => !studentStillTracked(row.state))) {
      if (!endedStudent) return null;
      return {
        tripId,
        segment: tripRow.segment,
        tripState: tripRow.state,
        studentState: endedStudent.state,
        studentId: endedStudent.studentId,
        vehicle: null,
        liveAvailable: false,
        staleMessage: null,
        ownStop: null,
        etaText: null,
        approaching: false,
        trackingEnded: true,
      };
    }
    return null;
  }

  const [current] = await tx
    .select()
    .from(vehicleCurrentLocation)
    .where(
      and(
        eq(vehicleCurrentLocation.tenantId, tenantId),
        eq(vehicleCurrentLocation.vehicleId, tripRow.vehicleId),
        eq(vehicleCurrentLocation.tripId, tripId),
        eq(vehicleCurrentLocation.sessionEpoch, tripRow.locationSessionEpoch),
      ),
    );
  const ageMs = current ? Date.now() - current.recordedAt.getTime() : null;
  const watchdog = gpsWatchdog(ageMs);
  const rejected = current?.quality === 'REJECTED';
  const live = liveLocationAvailable(watchdog, rejected);
  let ownStop: ParentLiveTrip['ownStop'] = null;
  if (trackable.expectedStopId) {
    const [stop] = await tx
      .select({
        lat: tripStop.snapshotLat,
        lng: tripStop.snapshotLng,
        label: tripStop.snapshotLabel,
      })
      .from(tripStop)
      .where(and(eq(tripStop.id, trackable.expectedStopId), eq(tripStop.tenantId, tenantId)));
    if (stop) ownStop = stop;
  }
  const vehicle: VehicleBroadcast | null =
    current && current.quality !== 'REJECTED'
      ? sharedTrackingPayload({
          vehicleLat: current.lat,
          vehicleLng: current.lng,
          heading: current.heading,
          recordedAt: current.recordedAt.toISOString().replace(/Z$/, '+00:00'),
          quality: current.quality === 'LOW' ? 'LOW' : 'GOOD',
        })
      : null;
  // ETA, aracın konumundan türetilir: konum canlı değilse tahmin de canlı
  // değildir. Eskiden araç işaretçisi gizlenirken ("liveAvailable: false")
  // yanında saatler önce hesaplanmış bir süre yazmaya devam ediyordu.
  const etaText =
    live && trackable.etaSeconds !== null
      ? formatParentEta({
          etaSeconds: trackable.etaSeconds,
          confidence: trackable.etaConfidence ?? 0.5,
        })
      : null;

  return {
    tripId,
    segment: tripRow.segment,
    tripState: tripRow.state,
    studentState: trackable.state,
    studentId: trackable.studentId,
    vehicle: live ? vehicle : null,
    liveAvailable: live,
    staleMessage: gpsWatchdogParentMessage(watchdog),
    ownStop,
    etaText,
    approaching: Boolean(trackable.approachNotifiedAt) || etaText === 'Yaklaşıyor',
    trackingEnded: false,
  };
}

/**
 * Rota canlı seferde gerçekten değiştiğinde (farklı teslimat, transfer, iptal)
 * baseline yeniden kurulur: yeni durak kümesi hemen, ağ beklemeden yazılır.
 * Gerçek yol bilgisine en çok ihtiyaç duyulan an tam da budur, bu yüzden sefer
 * Google iyileştirmesi için kuyruğa alınır — ama o çağrı transaction bittikten
 * SONRA yapılır (bkz. `drainBaselineRefines`).
 */
export async function refreshRoutesIfTripChanged(
  tx: Database,
  tenantId: string,
  tripId: string,
): Promise<void> {
  const [row] = await tx
    .select({
      state: trip.state,
      routesCallsCount: trip.routesCallsCount,
      lastRoutesCallAt: trip.lastRoutesCallAt,
    })
    .from(trip)
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  if (!row || row.state !== 'ACTIVE') return;
  await writeBaseline(tx, tenantId, tripId, { force: true });
  const mayCallGoogle = shouldRefreshRoutes({
    nowMs: Date.now(),
    lastRoutesCallAtMs: row.lastRoutesCallAt?.getTime() ?? null,
    routesCallsCount: row.routesCallsCount,
    offRouteM: null,
    unexpectedStopMs: null,
    etaConfidence: null,
    routeChanged: true,
    seriousEtaMiss: false,
  });
  if (mayCallGoogle) await requestBaselineRefine(tx, tenantId, tripId);
}

/**
 * Google denemesini kuyruğa alır ve geri çekilme damgasını ŞİMDİ basar.
 *
 * Damga kararın alındığı anda basılır, çağrının sonucuna bakılmaz: Google
 * erişilemezse bile bir sonraki ping hemen yeniden denemez. Gerçekleşen HTTP
 * sayısı ayrı tutulur (`routes_calls_count`), kota ondan sayılır.
 */
export async function requestBaselineRefine(
  tx: Database,
  tenantId: string,
  tripId: string,
): Promise<void> {
  await tx
    .update(trip)
    .set({ lastRoutesCallAt: new Date() })
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  queueBaselineRefine(tenantId, tripId);
}

/**
 * Baseline'ın transaction içindeki hâli: yalnız Haversine, HİÇ ağ çağrısı yok.
 *
 * Eskiden burada Google Routes'a HTTP yapılıyordu — üstelik `trip` satırı
 * `for update` kilitliyken ve zaman aşımı olmadan. Bir GPS ping'i Google
 * yavaşladığı sürece o aracın satır kilidini ve bir havuz bağlantısını
 * tutuyordu. Dış sağlayıcı transaction dışında çağrılır (outbox ile aynı
 * gerekçe, bkz. migration 0029).
 */
export async function writeBaseline(
  tx: Database,
  tenantId: string,
  tripId: string,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const [existing] = await tx
    .select({ baseline: trip.routeBaseline })
    .from(trip)
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  if (!existing) return false;
  if (!options.force && asBaseline(existing.baseline)) return false;
  const stops = await loadBaselineStops(tx, tenantId, tripId);
  if (stops.length < 2) return false;
  await tx
    .update(trip)
    .set({
      routeBaseline: chunkedHaversineBaseline(stops),
      baselineComputedAt: new Date(),
    })
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  return true;
}

async function loadBaselineStops(
  tx: Database,
  tenantId: string,
  tripId: string,
): Promise<{ id: string; lat: number; lng: number }[]> {
  return tx
    .select({ id: tripStop.id, lat: tripStop.snapshotLat, lng: tripStop.snapshotLng })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, tripId), eq(tripStop.tenantId, tenantId)))
    .orderBy(asc(tripStop.seq));
}

/**
 * Google iyileştirmesi bekleyen seferler. Anahtar kiracı+sefer olduğu için aynı
 * sefer için istekler yığılmaz; kuyruk yalnız kimlik taşır, bağlantı taşımaz.
 */
const pendingBaselineRefines = new Map<string, { tenantId: string; tripId: string }>();

function queueBaselineRefine(tenantId: string, tripId: string): void {
  pendingBaselineRefines.set(`${tenantId}:${tripId}`, { tenantId, tripId });
}

/**
 * Transaction kapandıktan SONRA çağrılır. Baseline bir iyileştirmedir: her
 * aşaması sessizce vazgeçebilir, çağıranın isteği bundan etkilenmez.
 */
export async function drainBaselineRefines(db: Database): Promise<void> {
  const items = [...pendingBaselineRefines.values()];
  pendingBaselineRefines.clear();
  for (const item of items) {
    try {
      await refineBaselineWithGoogle(db, item.tenantId, item.tripId);
    } catch {
      // Yol bilgisi iyileştirilemedi; Haversine baseline zaten yazılı.
    }
  }
}

const BASELINE_LOCK_TIMEOUT = '2s';

/**
 * Üç evre: kısa okuma transaction'ı → transaction'sız HTTP → kısa yazma
 * transaction'ı. Yazma evresi `lock_timeout` ile sınırlıdır; sefer satırı o an
 * başka bir istek tarafından kilitliyse iyileştirme atlanır, istek beklemez.
 */
async function refineBaselineWithGoogle(
  db: Database,
  tenantId: string,
  tripId: string,
): Promise<void> {
  const apiKey = process.env['NODE_ENV'] === 'test' ? '' : process.env['GOOGLE_MAPS_API_KEY'];
  if (!apiKey || apiKey.length < 8) return;
  const context = { tenantId, membershipId: null, role: 'SYSTEM' } as const;

  const plan = await withTenant(db, context, async (tx) => {
    const [row] = await tx
      .select({
        state: trip.state,
        startedAt: trip.actualStartedAt,
        routesCallsCount: trip.routesCallsCount,
      })
      .from(trip)
      .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
    if (!row || row.state !== 'ACTIVE') return null;
    // Aralık kontrolü kararı veren tarafta yapıldı ve damgası basıldı; burada
    // yalnız sefer başına çağrı kotası bakılır.
    if (row.routesCallsCount >= MAX_ROUTES_CALLS_PER_TRIP) return null;
    const stops = await loadBaselineStops(tx, tenantId, tripId);
    if (stops.length < 2) return null;
    return { stops, startedAt: row.startedAt ?? new Date(), calls: row.routesCallsCount };
  });
  if (!plan) return;

  const google = await computeGoogleRouteBaseline(plan.stops, plan.startedAt, { apiKey });
  if (!google) return;

  await withTenant(db, context, async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', ${BASELINE_LOCK_TIMEOUT}, true)`);
    await tx
      .update(trip)
      .set({
        routeBaseline: google.baseline,
        baselineComputedAt: new Date(),
        lastRoutesCallAt: new Date(),
        routesCallsCount: plan.calls + google.httpCalls,
      })
      .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId), eq(trip.state, 'ACTIVE')));
  });
}
