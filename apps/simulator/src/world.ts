import {
  applyStudentAction,
  canTransitionTrip,
  chunkedHaversineBaseline,
  evaluateGpsQuality,
  haversineMeters,
  remainingEtaSeconds,
  sharedTrackingPayload,
  tripBroadcastOpen,
  URBAN_BUS_SPEED_MPS,
  type ActorRole,
  type DeliveryTarget,
  type GpsSample,
  type LastGoodFix,
  type LatLng,
  type LocationQuality,
  type RoutePoint,
  type StudentAction,
  type StudentState,
  type TripState,
} from '@servisapp/domain';
import type { ScenarioId } from './cli.js';

export const ORIGIN: LatLng = { lat: 40.9819, lng: 29.0365 };
const TICK_MS = 10_000;

export interface AuditEvent {
  seq: number;
  type: string;
  tripId: string | null;
  studentId: string | null;
}

export interface SimTrip {
  id: string;
  state: TripState;
  epoch: number;
  deviceId: string;
  killGps: boolean;
  killRealtime: boolean;
  lastGood: LastGoodFix | null;
  routesCallsCount: number;
  lastRoutesCallAtMs: number | null;
  parentCount: number;
  vehicleSweepConfirmed: boolean;
  stops: RoutePoint[];
}

export interface SimStudent {
  id: string;
  tripId: string;
  state: StudentState;
  deliveryTarget: DeliveryTarget;
  deliveryVerified: boolean;
}

export interface SimWorld {
  nowMs: number;
  name: string;
  countsBroadcast: boolean;
  trips: Map<string, SimTrip>;
  students: Map<string, SimStudent>;
  events: AuditEvent[];
  broadcasts: number;
  gpsPackets: number;
  gpsAccepted: number;
  gpsRejected: number;
  pollReads: number;
  routesBaselineRequests: number;
  routesRefreshCalls: number;
  etaErrorsSec: number[];
  failures: string[];
  notes: string[];
}

export interface ScaleReport {
  gpsPackets: number;
  realtimeMessages: number;
  routesBaselineRequests: number;
  routesRefreshCalls: number;
  callsPerTrip: number;
  etaMaeSec: number | null;
  etaP95Sec: number | null;
  vehicles: number;
  students: number;
}

export interface SimResult {
  ok: boolean;
  scenario: ScenarioId;
  vehicles: number;
  students: number;
  failures: string[];
  notes: string[];
  scale: ScaleReport;
  invariants: Record<string, boolean>;
}

export function offsetMeters(origin: LatLng, northM: number, eastM: number): LatLng {
  return {
    lat: origin.lat + northM / 111_320,
    lng: origin.lng + eastM / (111_320 * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

export function fail(world: SimWorld, message: string): void {
  world.failures.push(message);
}

export function note(world: SimWorld, message: string): void {
  world.notes.push(message);
}

export function requireTrip(world: SimWorld, tripId: string): SimTrip {
  const trip = world.trips.get(tripId);
  if (!trip) throw new Error(`sefer yok: ${tripId}`);
  return trip;
}

export function requireStudent(world: SimWorld, studentId: string): SimStudent {
  const student = world.students.get(studentId);
  if (!student) throw new Error(`öğrenci yok: ${studentId}`);
  return student;
}

export function appendEvent(
  world: SimWorld,
  type: string,
  tripId: string | null,
  studentId: string | null,
): void {
  world.events.push({
    seq: world.events.length,
    type,
    tripId,
    studentId,
  });
}

export function createWorld(name: string, countsBroadcast: boolean, nowMs: number): SimWorld {
  return {
    nowMs,
    name,
    countsBroadcast,
    trips: new Map(),
    students: new Map(),
    events: [],
    broadcasts: 0,
    gpsPackets: 0,
    gpsAccepted: 0,
    gpsRejected: 0,
    pollReads: 0,
    routesBaselineRequests: 0,
    routesRefreshCalls: 0,
    etaErrorsSec: [],
    failures: [],
    notes: [],
  };
}

export function addTrip(
  world: SimWorld,
  tripIndex: number,
  studentCount: number,
  parentCount = 2,
): string {
  const id = `${world.name}-t${String(tripIndex)}`;
  const stops: RoutePoint[] = [
    { id: `${id}-s0`, ...ORIGIN },
    { id: `${id}-s1`, ...offsetMeters(ORIGIN, 400, 80) },
    { id: `${id}-s2`, ...offsetMeters(ORIGIN, 900, 40) },
  ];
  world.trips.set(id, {
    id,
    state: 'ACTIVE',
    epoch: 0,
    deviceId: `${id}-dev`,
    killGps: false,
    killRealtime: false,
    lastGood: { ...ORIGIN, recordedAtMs: world.nowMs },
    routesCallsCount: 1,
    lastRoutesCallAtMs: world.nowMs,
    parentCount,
    vehicleSweepConfirmed: false,
    stops,
  });
  const baseline = chunkedHaversineBaseline(stops, new Date(world.nowMs));
  world.routesBaselineRequests += Math.max(1, Math.ceil(baseline.legs.length / 26));
  for (let i = 0; i < studentCount; i += 1) {
    const studentId = `${id}-u${String(i)}`;
    world.students.set(studentId, {
      id: studentId,
      tripId: id,
      state: 'EXPECTED',
      deliveryTarget: 'HOME',
      deliveryVerified: false,
    });
  }
  appendEvent(world, 'TRIP_STARTED', id, null);
  return id;
}

export function actStudent(
  world: SimWorld,
  studentId: string,
  action: StudentAction,
  actorRole: ActorRole,
): boolean {
  const student = requireStudent(world, studentId);
  const trip = requireTrip(world, student.tripId);
  const result = applyStudentAction({
    action,
    currentState: student.state,
    tripState: trip.state,
    actorRole,
    deliveryTarget: student.deliveryTarget,
    deliveryVerified: student.deliveryVerified,
  });
  if (!result.ok) return false;
  student.state = result.nextState;
  appendEvent(world, `STUDENT_${action}`, trip.id, student.id);
  return true;
}

export function ingestGps(
  world: SimWorld,
  tripId: string,
  sample: GpsSample,
  deviceId: string,
  epoch: number,
): LocationQuality | 'AUTH' | 'REJECTED' {
  const trip = requireTrip(world, tripId);
  world.gpsPackets += 1;
  if (trip.killGps || !tripBroadcastOpen(trip.state)) {
    world.gpsRejected += 1;
    return 'AUTH';
  }
  if (epoch !== trip.epoch || deviceId !== trip.deviceId) {
    world.gpsRejected += 1;
    return 'AUTH';
  }
  const verdict = evaluateGpsQuality({
    nowMs: world.nowMs,
    sample,
    lastGood: trip.lastGood,
  });
  if (verdict.quality === 'REJECTED') {
    world.gpsRejected += 1;
    return 'REJECTED';
  }
  trip.lastGood = { lat: sample.lat, lng: sample.lng, recordedAtMs: sample.recordedAtMs };
  world.gpsAccepted += 1;
  sharedTrackingPayload({
    vehicleLat: sample.lat,
    vehicleLng: sample.lng,
    heading: 15,
    recordedAt: new Date(sample.recordedAtMs).toISOString(),
    quality: verdict.quality,
  });
  if (trip.killRealtime) {
    world.pollReads += 1;
  } else if (trip.parentCount < 2) {
    fail(world, `${trip.id} yayın çarpanı ölçülemez: veli < 2`);
  } else {
    world.broadcasts += 1;
  }
  const legs = chunkedHaversineBaseline(trip.stops, new Date(world.nowMs)).legs;
  const predicted = remainingEtaSeconds({
    vehicle: sample,
    stops: trip.stops.map((stop, seq) => ({ ...stop, seq })),
    targetStopId: trip.stops[trip.stops.length - 1]?.id ?? trip.stops[0]?.id ?? '',
    legs,
    observed: [],
  });
  const truth = Math.max(
    1,
    Math.round(
      haversineMeters(sample, trip.stops[trip.stops.length - 1] ?? sample) / URBAN_BUS_SPEED_MPS,
    ),
  );
  world.etaErrorsSec.push(Math.abs(predicted - truth));
  return verdict.quality;
}

export function sampleAt(
  _trip: SimTrip,
  northM: number,
  recordedAtMs: number,
  accuracyM = 8,
): GpsSample {
  const point = offsetMeters(ORIGIN, northM, northM * 0.1);
  return {
    ...point,
    accuracyM,
    speedMps: 8,
    recordedAtMs,
  };
}

export function streamGps(world: SimWorld, tripId: string, ticks: number): void {
  const trip = requireTrip(world, tripId);
  for (let i = 1; i <= ticks; i += 1) {
    world.nowMs += TICK_MS;
    ingestGps(world, tripId, sampleAt(trip, 20 * i, world.nowMs), trip.deviceId, trip.epoch);
  }
}

export function completeTrip(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  for (const student of world.students.values()) {
    if (student.tripId !== tripId) continue;
    if (
      student.state === 'EXPECTED' ||
      student.state === 'NO_SHOW' ||
      student.state === 'ABSENT_PLANNED'
    ) {
      if (!actStudent(world, student.id, 'BOARD', 'DRIVER')) {
        fail(world, `${student.id} bindirilemedi`);
        continue;
      }
    }
    if (student.state === 'ON_BOARD') {
      if (student.deliveryTarget === 'TEMP' && !student.deliveryVerified) {
        fail(world, `${student.id} TEMP doğrulamasız teslim denendi`);
        continue;
      }
      if (!actStudent(world, student.id, 'DELIVER', 'DRIVER')) {
        fail(world, `${student.id} teslim edilemedi`);
      }
    }
  }
  trip.vehicleSweepConfirmed = true;
  const states = [...world.students.values()]
    .filter((row) => row.tripId === tripId)
    .map((row) => row.state);
  const transition = canTransitionTrip({
    from: trip.state,
    to: 'COMPLETED',
    actorRole: 'DRIVER',
    vehicleSweepConfirmed: true,
    studentStates: states,
  });
  if (!transition.ok) {
    fail(world, `${tripId} kapanamadı: ${transition.reason}`);
    return;
  }
  trip.state = 'COMPLETED';
  appendEvent(world, 'TRIP_COMPLETED', tripId, null);
}

export function tryCompleteWithOnBoard(world: SimWorld, tripId: string): boolean {
  const trip = requireTrip(world, tripId);
  const states = [...world.students.values()]
    .filter((row) => row.tripId === tripId)
    .map((row) => row.state);
  const transition = canTransitionTrip({
    from: trip.state,
    to: 'COMPLETED',
    actorRole: 'DRIVER',
    vehicleSweepConfirmed: true,
    studentStates: states,
  });
  return transition.ok;
}

export function worldInvariants(world: SimWorld): Record<string, boolean> {
  const completedOnBoard = [...world.trips.values()].some((trip) => {
    if (trip.state !== 'COMPLETED') return false;
    return [...world.students.values()].some(
      (student) => student.tripId === trip.id && student.state === 'ON_BOARD',
    );
  });
  const studentIds = [...world.students.keys()];
  const uniqueStudents = new Set(studentIds).size === studentIds.length;
  const unverifiedTemp = [...world.students.values()].some(
    (student) =>
      student.deliveryTarget === 'TEMP' &&
      student.state === 'DELIVERED' &&
      !student.deliveryVerified,
  );
  const eventSeqs = world.events.map((row) => row.seq);
  const seqMonotone = eventSeqs.every((seq, index) => seq === index);
  const broadcastOk = !world.countsBroadcast || world.broadcasts === world.gpsAccepted;
  const parentFanout = [...world.trips.values()].every((trip) => trip.parentCount >= 2);
  return {
    no_on_board_at_complete: !completedOnBoard,
    unique_student_rows: uniqueStudents,
    no_unverified_temp_delivery: !unverifiedTemp,
    event_append_only: seqMonotone,
    broadcast_not_times_parents: broadcastOk && parentFanout,
  };
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function scaleFromWorlds(
  worlds: readonly SimWorld[],
  vehicles: number,
  students: number,
): ScaleReport {
  const gpsPackets = worlds.reduce((sum, world) => sum + world.gpsPackets, 0);
  const realtimeMessages = worlds.reduce((sum, world) => sum + world.broadcasts, 0);
  const routesBaselineRequests = worlds.reduce(
    (sum, world) => sum + world.routesBaselineRequests,
    0,
  );
  const routesRefreshCalls = worlds.reduce((sum, world) => sum + world.routesRefreshCalls, 0);
  const tripCount = worlds.reduce((sum, world) => sum + world.trips.size, 0) || 1;
  const etaErrors = worlds.flatMap((world) => world.etaErrorsSec);
  return {
    gpsPackets,
    realtimeMessages,
    routesBaselineRequests,
    routesRefreshCalls,
    callsPerTrip: routesRefreshCalls / tripCount,
    etaMaeSec: mean(etaErrors),
    etaP95Sec: percentile(etaErrors, 0.95),
    vehicles,
    students,
  };
}
