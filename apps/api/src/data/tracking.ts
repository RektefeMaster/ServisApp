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
  parentCanTrack,
  remainingEtaSeconds,
  sharedTrackingPayload,
  shouldArchivePing,
  shouldNotifyApproach,
  shouldRefreshRoutes,
  studentStillTracked,
  type BaselineLeg,
  type GpsAuthReason,
  type ObservedLeg,
  type RouteBaseline,
} from '@servisapp/domain';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { gone, HttpError, notFound } from '../http-error.js';
import type { MemoryRealtimeTransport } from '../realtime/memory.js';
import { computeGoogleRouteBaseline } from './google-routes.js';
import { mapDbError } from './db-error.js';
import { loadParentChildren } from './plan-query.js';
import type { TripActor } from './ports.js';

const FAILOVER_MS = 60_000;
const STOP_ARRIVAL_RADIUS_M = 75;

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
  return {
    realtime,
    ingest(tenantId, actor, tripId, input) {
      return withTracking(db, tenantId, actor.membershipId, crewRole(actor), async (tx) => {
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
          plannedDepartureAt: row.plannedDepartureAt,
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
          await writeHaversineBaseline(tx, tenantId, tripId, { force: true });
        }

        return {
          accepted: true,
          quality,
          liveAvailable: true,
          sessionEpoch,
          locationSourceDeviceId: sourceDeviceId,
          trackingEnded: false,
        };
      });
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
          items.push({
            ...child,
            live: live && !live.trackingEnded ? live : null,
            day: null,
          });
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

  const [tenantRow] = await tx
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, input.tenantId));
  const threshold = approachMinutes(tenantRow?.settings);
  const sampleConfidence = etaConfidence({
    gpsAgeMs: input.now.getTime() - input.recordedAtMs,
    accuracyM: input.accuracyM,
    offRouteM,
    hasBaseline: Boolean(input.baseline),
    delayFactor: factor,
  });

  for (const student of students) {
    if (!studentStillTracked(student.state)) continue;
    if (!student.expectedStopId) continue;
    const etaSeconds = remainingEtaSeconds({
      vehicle: input.vehicle,
      stops: etaStops,
      targetStopId: student.expectedStopId,
      legs,
      observed,
    });
    const notify = shouldNotifyApproach({
      etaSeconds,
      previousEtaSeconds: student.etaSeconds,
      approachNotifiedAt: student.approachNotifiedAt?.toISOString() ?? null,
      thresholdMinutes: threshold,
    });
    const approachAt = notify ? input.now : student.approachNotifiedAt;
    const approachSql = approachAt
      ? sql`${approachAt.toISOString()}::timestamptz`
      : sql`null::timestamptz`;
    await tx.execute(sql`
      select update_trip_student_tracking(
        ${student.id}::uuid,
        ${etaSeconds}::integer,
        ${sampleConfidence}::real,
        ${input.now.toISOString()}::timestamptz,
        ${approachSql}
      )
    `);
    if (notify) {
      await queueApproachNotifications(tx, input.tenantId, input.tripId, student.studentId);
    }
  }
  return { offRouteM, sampleConfidence, delayFactor: factor };
}

async function blendBaselineLegs(
  tx: Database,
  tenantId: string,
  tripId: string,
  routeId: string,
  plannedDepartureAt: Date,
  legs: readonly BaselineLeg[],
): Promise<BaselineLeg[]> {
  if (legs.length === 0) return [];
  const bucket = timeBucketOf(plannedDepartureAt);
  const stats = await tx
    .select({
      fromStopId: routeSegmentStat.fromStopId,
      toStopId: routeSegmentStat.toStopId,
      sampleCount: routeSegmentStat.sampleCount,
      medianSeconds: routeSegmentStat.medianSeconds,
    })
    .from(routeSegmentStat)
    .where(
      and(
        eq(routeSegmentStat.tenantId, tenantId),
        eq(routeSegmentStat.routeId, routeId),
        eq(routeSegmentStat.weekday, bucket.weekday),
        eq(routeSegmentStat.timeBucket, bucket.hour),
      ),
    );
  const byKey = new Map(stats.map((row) => [`${row.fromStopId}:${row.toStopId}`, row] as const));
  const tripStops = await tx
    .select({ id: tripStop.id, sourceStopId: tripStop.sourceStopId })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, tripId), eq(tripStop.tenantId, tenantId)));
  const sourceOf = new Map(tripStops.map((row) => [row.id, row.sourceStopId]));
  return legs.map((leg) => {
    const fromSource = sourceOf.get(leg.fromStopId);
    const toSource = sourceOf.get(leg.toStopId);
    const stat = fromSource && toSource ? byKey.get(`${fromSource}:${toSource}`) : undefined;
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

function timeBucketOf(at: Date): { weekday: number; hour: number } {
  return { weekday: at.getUTCDay(), hour: at.getUTCHours() };
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
  if (nearest <= STOP_ARRIVAL_RADIUS_M) return null;
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
    plannedDepartureAt: Date;
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
  const next = stops.find((stop) => !stop.arrivedAt);
  if (!next) return;
  const distance = haversineMeters(input.vehicle, { lat: next.lat, lng: next.lng });
  if (distance > STOP_ARRIVAL_RADIUS_M) return;
  await tx
    .update(tripStop)
    .set({ actualArrivedAt: input.now })
    .where(and(eq(tripStop.id, next.id), eq(tripStop.tenantId, input.tenantId)));
  const previous = [...stops]
    .reverse()
    .find((stop) => stop.arrivedAt && Number(stop.seq) < Number(next.seq));
  if (!previous?.sourceStopId || !next.sourceStopId || !previous.arrivedAt) return;
  const actualSec = Math.max(
    1,
    Math.round((input.now.getTime() - previous.arrivedAt.getTime()) / 1000),
  );
  const bucket = timeBucketOf(input.plannedDepartureAt);
  await tx
    .insert(routeSegmentStat)
    .values({
      tenantId: input.tenantId,
      routeId: input.routeId,
      fromStopId: previous.sourceStopId,
      toStopId: next.sourceStopId,
      weekday: bucket.weekday,
      timeBucket: bucket.hour,
      sampleCount: 1,
      avgSeconds: actualSec,
      medianSeconds: actualSec,
      p75Seconds: actualSec,
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
        sampleCount: sql`${routeSegmentStat.sampleCount} + 1`,
        avgSeconds: sql`coalesce((
          (${routeSegmentStat.avgSeconds} * ${routeSegmentStat.sampleCount} + ${actualSec})
          / (${routeSegmentStat.sampleCount} + 1)
        )::int, ${actualSec})`,
        medianSeconds: sql`coalesce((
          (${routeSegmentStat.medianSeconds} * ${routeSegmentStat.sampleCount} + ${actualSec})
          / (${routeSegmentStat.sampleCount} + 1)
        )::int, ${actualSec})`,
        p75Seconds: sql`greatest(coalesce(${routeSegmentStat.p75Seconds}, ${actualSec}), ${actualSec})`,
        updatedAt: input.now,
      },
    });
}

function approachMinutes(settings: unknown): number {
  if (!settings || typeof settings !== 'object') return 5;
  const value = (settings as { approachNotificationMinutes?: unknown }).approachNotificationMinutes;
  return typeof value === 'number' && value > 0 && value < 30 ? value : 5;
}

async function queueApproachNotifications(
  tx: Database,
  tenantId: string,
  tripId: string,
  studentId: string,
): Promise<void> {
  const guardians = await tx
    .select({ membershipId: studentGuardian.guardianMembershipId })
    .from(studentGuardian)
    .where(
      and(
        eq(studentGuardian.tenantId, tenantId),
        eq(studentGuardian.studentId, studentId),
        eq(studentGuardian.status, 'ACTIVE'),
      ),
    );
  for (const guardian of guardians) {
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
    })
    .from(tripStudent)
    .innerJoin(trip, and(eq(trip.id, tripStudent.tripId), eq(trip.tenantId, tenantId)))
    .where(and(eq(tripStudent.tenantId, tenantId), eq(tripStudent.studentId, studentId)))
    .orderBy(desc(trip.serviceDate), desc(trip.actualStartedAt));
  const active = rows.find((row) => row.tripState === 'ACTIVE');
  if (!active) return null;
  return loadParentTripView(tx, tenantId, membershipId, active.tripId, studentId);
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
  const etaText =
    trackable.etaSeconds !== null
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

/** Rota değişince (TEMP, transfer) event-driven yenileme; guardrail SPEC §8. */
export async function refreshRoutesIfTripChanged(
  tx: Database,
  tenantId: string,
  tripId: string,
): Promise<void> {
  const [row] = await tx
    .select({
      state: trip.state,
    })
    .from(trip)
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  if (!row || row.state !== 'ACTIVE') return;
  await writeHaversineBaseline(tx, tenantId, tripId, { force: true, skipGoogle: true });
}

export async function writeHaversineBaseline(
  tx: Database,
  tenantId: string,
  tripId: string,
  options: { force?: boolean; skipGoogle?: boolean } = {},
): Promise<void> {
  const [existing] = await tx
    .select({
      baseline: trip.routeBaseline,
      routesCallsCount: trip.routesCallsCount,
      startedAt: trip.actualStartedAt,
    })
    .from(trip)
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  if (!options.force && asBaseline(existing?.baseline)) return;
  const stops = await tx
    .select({
      id: tripStop.id,
      lat: tripStop.snapshotLat,
      lng: tripStop.snapshotLng,
    })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, tripId), eq(tripStop.tenantId, tenantId)))
    .orderBy(asc(tripStop.seq));
  if (stops.length < 2) return;
  const google = options.skipGoogle
    ? null
    : await computeGoogleRouteBaseline(stops, existing?.startedAt ?? new Date(), {
        apiKey: process.env['NODE_ENV'] === 'test' ? '' : process.env['GOOGLE_MAPS_API_KEY'],
      });
  const baseline = google?.baseline ?? chunkedHaversineBaseline(stops);
  await tx
    .update(trip)
    .set({
      routeBaseline: baseline,
      baselineComputedAt: new Date(),
      ...(options.skipGoogle ? {} : { lastRoutesCallAt: new Date() }),
      ...(google ? { routesCallsCount: (existing?.routesCallsCount ?? 0) + google.httpCalls } : {}),
    })
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
}
