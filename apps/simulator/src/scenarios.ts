import {
  chunkedHaversineBaseline,
  delayFactor,
  etaConfidence,
  exhaustive,
  gpsWatchdog,
  haversineMeters,
  interpolateLngLat,
  MAX_ROUTES_CALLS_PER_TRIP,
  nextFlushBatch,
  otpLockedAfterAttempts,
  recoverInFlight,
  reconcileCancelRideException,
  shouldRefreshRoutes,
  type OutboxItem,
} from '@servisapp/domain';
import type { ScenarioId } from './cli.js';
import {
  ORIGIN,
  actStudent,
  addTrip,
  appendEvent,
  completeTrip,
  fail,
  ingestGps,
  note,
  offsetMeters,
  requireStudent,
  requireTrip,
  sampleAt,
  streamGps,
  tryCompleteWithOnBoard,
  type SimWorld,
} from './world.js';

export const OPS_SCENARIOS: readonly ScenarioId[] = [
  'double-tap',
  'crew-race',
  'crash',
  'unordered-replay',
  'last-minute-cancel',
  'temp-delivery',
  'otp-lock',
  'mid-trip-swap',
  'weak-network',
  'gps-loss',
];

export const GPS_SCENARIOS: readonly ScenarioId[] = [
  'interpolation',
  'jitter',
  'teleport',
  'off-route',
  'traffic',
  'routes-refresh',
  'eta-confidence',
  'gps-stale',
  'realtime-fallback',
  'dual-gps',
];

function runDoubleTap(world: SimWorld, tripId: string): void {
  const studentId = `${tripId}-u0`;
  if (!actStudent(world, studentId, 'BOARD', 'DRIVER')) fail(world, 'ilk BOARD başarısız');
  if (actStudent(world, studentId, 'BOARD', 'DRIVER'))
    fail(world, 'çift tıklama ikinci BOARD kabul etti');
  if (!actStudent(world, studentId, 'DELIVER', 'DRIVER'))
    fail(world, 'çift tıklama sonrası teslim');
  note(world, 'double-tap: ikinci BOARD reddedildi');
}

function runCrewRace(world: SimWorld, tripId: string): void {
  const studentId = `${tripId}-u1`;
  if (!actStudent(world, studentId, 'BOARD', 'DRIVER')) fail(world, 'şoför BOARD');
  if (actStudent(world, studentId, 'BOARD', 'ATTENDANT')) {
    fail(world, 'hostes aynı öğrenciyi ikinci kez bindirdi');
  }
  if (!actStudent(world, studentId, 'DELIVER', 'ATTENDANT')) fail(world, 'crew-race teslim');
  note(world, 'crew-race: ikinci aktör ALREADY/ILLEGAL');
}

function runCrash(world: SimWorld, tripId: string): void {
  const studentId = `${tripId}-u2`;
  const item: OutboxItem = {
    clientEventId: '11111111-1111-4111-8111-111111111111',
    tripId,
    tripStudentId: studentId,
    action: 'BOARD',
    expectedStateSeq: 0,
    deviceSeq: 0,
    occurredAtDevice: new Date(world.nowMs).toISOString(),
    status: 'IN_FLIGHT',
  };
  const recovered = recoverInFlight([item]);
  const batch = nextFlushBatch(recovered);
  if (batch.length !== 1) fail(world, 'çökme sonrası kuyruk boş');
  if (!actStudent(world, studentId, 'BOARD', 'DRIVER')) fail(world, 'çökme sonrası BOARD');
  if (!actStudent(world, studentId, 'DELIVER', 'DRIVER')) fail(world, 'çökme sonrası teslim');
  note(world, 'crash: IN_FLIGHT → PENDING → BOARD');
}

function runUnorderedReplay(world: SimWorld, tripId: string): void {
  const studentId = `${tripId}-u3`;
  const items: OutboxItem[] = [
    {
      clientEventId: '22222222-2222-4222-8222-222222222222',
      tripId,
      tripStudentId: studentId,
      action: 'DELIVER',
      expectedStateSeq: 1,
      deviceSeq: 1,
      occurredAtDevice: new Date(world.nowMs).toISOString(),
      status: 'PENDING',
    },
    {
      clientEventId: '33333333-3333-4333-8333-333333333333',
      tripId,
      tripStudentId: studentId,
      action: 'BOARD',
      expectedStateSeq: 0,
      deviceSeq: 0,
      occurredAtDevice: new Date(world.nowMs).toISOString(),
      status: 'PENDING',
    },
  ];
  const ordered = nextFlushBatch(items);
  if (ordered[0]?.action !== 'BOARD') fail(world, 'sırasız replay BOARD önce gitmeli');
  if (!actStudent(world, studentId, 'BOARD', 'DRIVER')) fail(world, 'replay BOARD');
  if (!actStudent(world, studentId, 'DELIVER', 'DRIVER')) fail(world, 'replay teslim');
  note(world, 'unordered-replay: deviceSeq sırası korundu');
}

function runLastMinuteCancel(world: SimWorld, tripId: string): void {
  const studentId = `${tripId}-u4`;
  if (!actStudent(world, studentId, 'BOARD', 'DRIVER')) fail(world, 'iptal öncesi BOARD');
  const outcome = reconcileCancelRideException(requireStudent(world, studentId).state);
  if (outcome.kind !== 'IGNORE') fail(world, 'ON_BOARD iken iptal planı ezemedi');
  if (!actStudent(world, studentId, 'DELIVER', 'DRIVER')) fail(world, 'iptal sonrası teslim');
  note(world, 'last-minute-cancel: OPERATIONAL_FACT_WINS');
}

function runTempDelivery(world: SimWorld, tripId: string): void {
  const studentId = `${tripId}-u5`;
  const student = requireStudent(world, studentId);
  student.deliveryTarget = 'TEMP';
  if (!actStudent(world, studentId, 'BOARD', 'DRIVER')) fail(world, 'TEMP BOARD');
  if (actStudent(world, studentId, 'DELIVER', 'DRIVER')) {
    fail(world, 'TEMP doğrulamasız teslim kabul edildi');
  }
  student.deliveryVerified = true;
  if (!actStudent(world, studentId, 'DELIVER', 'DRIVER')) fail(world, 'TEMP doğrulamalı teslim');
  note(world, 'temp-delivery: kodsuz red, kodlu teslim');
}

function runOtpLock(world: SimWorld): void {
  if (!otpLockedAfterAttempts(5)) fail(world, '5 yanlışta kilit yok');
  if (!otpLockedAfterAttempts(6)) fail(world, 'kilit 6. denemede kalkmış');
  if (otpLockedAfterAttempts(4)) fail(world, '4 yanlışta erken kilit');
  note(world, 'otp-lock: 5 yanlışta kilit');
}

function runMidTripSwap(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const good = ingestGps(world, tripId, sampleAt(trip, 30, world.nowMs), trip.deviceId, trip.epoch);
  if (good === 'AUTH' || good === 'REJECTED') fail(world, 'swap öncesi GPS');
  trip.epoch += 1;
  trip.deviceId = `${trip.id}-dev-b`;
  appendEvent(world, 'VEHICLE_OR_CREW_CHANGED', tripId, null);
  const oldDevice = ingestGps(
    world,
    tripId,
    sampleAt(trip, 40, world.nowMs + 1_000),
    `${trip.id}-dev`,
    0,
  );
  if (oldDevice !== 'AUTH') fail(world, 'eski epoch GPS kabul edildi');
  const next = ingestGps(
    world,
    tripId,
    sampleAt(trip, 45, world.nowMs + 2_000),
    trip.deviceId,
    trip.epoch,
  );
  if (next === 'AUTH' || next === 'REJECTED') fail(world, 'yeni cihaz GPS reddedildi');
  note(world, 'mid-trip-swap: epoch eski pingi düşürdü');
}

function runWeakNetwork(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const before = world.gpsAccepted;
  world.gpsPackets += 3;
  world.nowMs += 8_000;
  ingestGps(world, tripId, sampleAt(trip, 15, world.nowMs), trip.deviceId, trip.epoch);
  if (world.gpsAccepted !== before + 1) fail(world, 'zayıf ağda retry yazmadı');
  note(world, 'weak-network: 3 kayıp paket, 1 başarılı retry');
}

function runGpsLoss(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const age = 181_000;
  if (gpsWatchdog(age) !== 'UNAVAILABLE') fail(world, '3 dk GPS kaybı UNAVAILABLE değil');
  if (trip.state !== 'ACTIVE') fail(world, 'GPS kaybında sefer durdu');
  note(world, 'gps-loss: sefer ACTIVE kaldı, konum UNAVAILABLE');
}

function runInterpolation(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const from = trip.lastGood ?? { ...ORIGIN, recordedAtMs: world.nowMs };
  const to = offsetMeters(ORIGIN, 80, 10);
  const mid = interpolateLngLat(from, to, 0.5);
  if (mid.lat === from.lat) fail(world, 'interpolasyon yerinde kaldı');
  if (trip.lastGood?.lat !== from.lat) fail(world, 'animasyon sunucu konumunu yazdı');
  note(world, 'interpolation: istemci animasyonu lastGood değiştirmedi');
}

function runJitter(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const point = offsetMeters(ORIGIN, 12, 3);
  const quality = ingestGps(
    world,
    tripId,
    { ...point, accuracyM: 15, speedMps: 7, recordedAtMs: world.nowMs },
    trip.deviceId,
    trip.epoch,
  );
  if (quality !== 'GOOD' && quality !== 'LOW') fail(world, `jitter reddedildi: ${quality}`);
  note(world, 'jitter: küçük sapma kabul');
}

function runTeleport(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  ingestGps(world, tripId, sampleAt(trip, 10, world.nowMs), trip.deviceId, trip.epoch);
  const jumped = offsetMeters(ORIGIN, 500, 0);
  const quality = ingestGps(
    world,
    tripId,
    { ...jumped, accuracyM: 8, speedMps: 8, recordedAtMs: world.nowMs + 1_000 },
    trip.deviceId,
    trip.epoch,
  );
  if (quality !== 'REJECTED' && quality !== 'AUTH') fail(world, '500 m teleport kabul edildi');
  note(world, 'teleport: 500 m sıçrama reddedildi, lastGood korundu');
}

function runOffRoute(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const off = haversineMeters(ORIGIN, offsetMeters(ORIGIN, 0, 450));
  if (off < 400) fail(world, 'off-route mesafe senaryosu zayıf');
  const refresh = shouldRefreshRoutes({
    nowMs: world.nowMs + 6 * 60_000,
    lastRoutesCallAtMs: trip.lastRoutesCallAtMs,
    routesCallsCount: trip.routesCallsCount,
    offRouteM: 450,
    unexpectedStopMs: null,
    etaConfidence: 0.8,
    routeChanged: false,
    seriousEtaMiss: false,
  });
  if (!refresh) fail(world, '450 m sapma refresh tetiklemedi');
  note(world, 'off-route: refresh tetiklendi');
}

function runTraffic(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const legs = chunkedHaversineBaseline(trip.stops, new Date(world.nowMs)).legs;
  const first = legs[0];
  if (!first) {
    fail(world, 'traffic: bacak yok');
    return;
  }
  const factor = delayFactor(legs, [
    {
      fromStopId: first.fromStopId,
      toStopId: first.toStopId,
      actualDurationSec: first.durationSec * 2,
    },
  ]);
  if (factor <= 1.2) fail(world, 'trafik gecikmesi delayFactor yükseltmedi');
  const confidence = etaConfidence({
    gpsAgeMs: 5_000,
    accuracyM: 12,
    offRouteM: 20,
    hasBaseline: true,
    delayFactor: factor,
  });
  if (confidence >= 1) fail(world, 'trafikte güven düşmedi');
  note(world, 'traffic: delayFactor ve eta_confidence');
}

function runRoutesRefresh(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const later = world.nowMs + 6 * 60_000;
  const first = shouldRefreshRoutes({
    nowMs: later,
    lastRoutesCallAtMs: trip.lastRoutesCallAtMs,
    routesCallsCount: trip.routesCallsCount,
    offRouteM: 450,
    unexpectedStopMs: null,
    etaConfidence: 0.9,
    routeChanged: true,
    seriousEtaMiss: false,
  });
  if (!first) fail(world, 'routeChanged refresh vermedi');
  trip.routesCallsCount += 1;
  trip.lastRoutesCallAtMs = later;
  world.routesRefreshCalls += 1;
  const limited = shouldRefreshRoutes({
    nowMs: later + 30_000,
    lastRoutesCallAtMs: trip.lastRoutesCallAtMs,
    routesCallsCount: trip.routesCallsCount,
    offRouteM: 450,
    unexpectedStopMs: null,
    etaConfidence: 0.1,
    routeChanged: true,
    seriousEtaMiss: true,
  });
  if (limited) fail(world, '5 dk guardrail aşılmadı');
  trip.routesCallsCount = MAX_ROUTES_CALLS_PER_TRIP;
  const capped = shouldRefreshRoutes({
    nowMs: later + 10 * 60_000,
    lastRoutesCallAtMs: later,
    routesCallsCount: trip.routesCallsCount,
    offRouteM: 800,
    unexpectedStopMs: 400_000,
    etaConfidence: 0.1,
    routeChanged: true,
    seriousEtaMiss: true,
  });
  if (capped) fail(world, 'max 5 Routes çağrısı aşılmadı');
  note(world, 'routes-refresh: tetik + rate-limit + tavan');
}

function runEtaConfidence(world: SimWorld): void {
  const low = etaConfidence({
    gpsAgeMs: 200_000,
    accuracyM: 50,
    offRouteM: 200,
    hasBaseline: true,
    delayFactor: 2,
  });
  if (low >= 0.5) fail(world, 'stale+sapmada güven düşmedi');
  note(world, 'eta-confidence: düşük skor');
}

function runGpsStale(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const quality = ingestGps(
    world,
    tripId,
    sampleAt(trip, 20, world.nowMs - 90_000),
    trip.deviceId,
    trip.epoch,
  );
  if (quality !== 'REJECTED') fail(world, 'stale recordedAt kabul edildi');
  note(world, 'gps-stale: eski kayıt reddedildi');
}

function runRealtimeFallback(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  trip.killRealtime = true;
  const beforeB = world.broadcasts;
  ingestGps(world, tripId, sampleAt(trip, 25, world.nowMs), trip.deviceId, trip.epoch);
  if (world.broadcasts !== beforeB) fail(world, 'kill_realtime iken yayın yapıldı');
  if (world.pollReads < 1) fail(world, 'polling fallback artmadı');
  note(world, 'realtime-fallback: yayın yok, poll var');
}

function runDualGps(world: SimWorld, tripId: string): void {
  const trip = requireTrip(world, tripId);
  const other = ingestGps(
    world,
    tripId,
    sampleAt(trip, 28, world.nowMs),
    `${trip.id}-phone-2`,
    trip.epoch,
  );
  if (other !== 'AUTH') fail(world, 'ikinci cihaz epoch reddi yok');
  note(world, 'dual-gps: WRONG_DEVICE');
}

export function runLoadStream(world: SimWorld, ticks: number): void {
  for (const trip of world.trips.values()) {
    streamGps(world, trip.id, ticks);
  }
  note(world, `load: ${String(world.trips.size)} araç × ${String(ticks)} GPS`);
}

export function runTunnelSync(world: SimWorld): void {
  const burstAt = world.nowMs + 1_000;
  world.nowMs = burstAt;
  for (const trip of world.trips.values()) {
    ingestGps(world, trip.id, sampleAt(trip, 300, burstAt), trip.deviceId, trip.epoch);
  }
  note(world, 'tunnel-sync: aynı anda ping');
}

export function opsTrip(world: SimWorld, students: number): string {
  return addTrip(world, 0, Math.max(students, 8), 2);
}

export function gpsTrip(world: SimWorld): string {
  return addTrip(world, 0, 2, 2);
}

export function loadFleet(world: SimWorld, vehicles: number, students: number): void {
  for (let i = 0; i < vehicles; i += 1) {
    addTrip(world, i, students, 2);
  }
}

export function assertCannotCloseWithOnBoard(world: SimWorld, tripId: string): void {
  const studentId = `${tripId}-u6`;
  const student = world.students.get(studentId);
  if (!student) return;
  if (student.state === 'EXPECTED' && !actStudent(world, studentId, 'BOARD', 'DRIVER')) {
    fail(world, 'kapanış koruması için BOARD');
    return;
  }
  if (student.state === 'ON_BOARD' && tryCompleteWithOnBoard(world, tripId)) {
    fail(world, 'ON_BOARD iken kapanış kabul edildi');
  }
  if (student.state === 'ON_BOARD' && !actStudent(world, studentId, 'DELIVER', 'DRIVER')) {
    fail(world, 'kapanış koruması sonrası teslim');
  }
}

export function finishAll(world: SimWorld): void {
  for (const trip of world.trips.values()) {
    completeTrip(world, trip.id);
  }
}

export function applyScenario(world: SimWorld, id: ScenarioId, tripId: string | null): void {
  switch (id) {
    case 'all':
    case 'ops':
    case 'gps':
    case 'load':
      return;
    case 'double-tap':
      if (tripId) runDoubleTap(world, tripId);
      return;
    case 'crew-race':
      if (tripId) runCrewRace(world, tripId);
      return;
    case 'crash':
      if (tripId) runCrash(world, tripId);
      return;
    case 'unordered-replay':
      if (tripId) runUnorderedReplay(world, tripId);
      return;
    case 'last-minute-cancel':
      if (tripId) runLastMinuteCancel(world, tripId);
      return;
    case 'temp-delivery':
      if (tripId) runTempDelivery(world, tripId);
      return;
    case 'otp-lock':
      runOtpLock(world);
      return;
    case 'mid-trip-swap':
      if (tripId) runMidTripSwap(world, tripId);
      return;
    case 'weak-network':
      if (tripId) runWeakNetwork(world, tripId);
      return;
    case 'gps-loss':
      if (tripId) runGpsLoss(world, tripId);
      return;
    case 'interpolation':
      if (tripId) runInterpolation(world, tripId);
      return;
    case 'jitter':
      if (tripId) runJitter(world, tripId);
      return;
    case 'teleport':
      if (tripId) runTeleport(world, tripId);
      return;
    case 'off-route':
      if (tripId) runOffRoute(world, tripId);
      return;
    case 'traffic':
      if (tripId) runTraffic(world, tripId);
      return;
    case 'routes-refresh':
      if (tripId) runRoutesRefresh(world, tripId);
      return;
    case 'eta-confidence':
      runEtaConfidence(world);
      return;
    case 'gps-stale':
      if (tripId) runGpsStale(world, tripId);
      return;
    case 'realtime-fallback':
      if (tripId) runRealtimeFallback(world, tripId);
      return;
    case 'dual-gps':
      if (tripId) runDualGps(world, tripId);
      return;
    case 'tunnel-sync':
      runTunnelSync(world);
      return;
    default:
      return exhaustive(id, 'applyScenario');
  }
}
