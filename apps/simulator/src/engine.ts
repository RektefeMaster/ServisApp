import { scenarioGroup, type SimOptions } from './cli.js';
import {
  GPS_SCENARIOS,
  OPS_SCENARIOS,
  applyScenario,
  assertCannotCloseWithOnBoard,
  finishAll,
  gpsTrip,
  loadFleet,
  opsTrip,
  runLoadStream,
  runTunnelSync,
} from './scenarios.js';
import {
  createWorld,
  scaleFromWorlds,
  worldInvariants,
  type SimResult,
  type SimWorld,
} from './world.js';

const NOW = Date.parse('2026-09-11T04:10:00.000Z');

function mergeInvariants(worlds: readonly SimWorld[]): Record<string, boolean> {
  const keys = [
    'no_on_board_at_complete',
    'unique_student_rows',
    'no_unverified_temp_delivery',
    'event_append_only',
    'broadcast_not_times_parents',
  ] as const;
  const merged: Record<string, boolean> = {};
  for (const key of keys) {
    merged[key] = worlds.every((world) => worldInvariants(world)[key]);
  }
  return merged;
}

function resultOf(opts: SimOptions, worlds: SimWorld[]): SimResult {
  const invariants = mergeInvariants(worlds);
  const failures = worlds.flatMap((world) => world.failures);
  const notes = worlds.flatMap((world) => world.notes);
  const failedKeys = Object.entries(invariants)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
  return {
    ok: failures.length === 0 && failedKeys.length === 0,
    scenario: opts.scenario,
    vehicles: opts.vehicles,
    students: opts.students,
    failures: [...failures, ...failedKeys.map((key) => `invariant:${key}`)],
    notes,
    scale: scaleFromWorlds(worlds, opts.vehicles, opts.students),
    invariants,
  };
}

export function runSimulation(opts: SimOptions): SimResult {
  const group = scenarioGroup(opts.scenario);
  const worlds: SimWorld[] = [];

  if (opts.scenario === 'all' || group === 'ops' || OPS_SCENARIOS.includes(opts.scenario)) {
    const world = createWorld('ops', true, NOW);
    const tripId = opsTrip(world, 8);
    const ids =
      opts.scenario === 'all' || opts.scenario === 'ops' ? OPS_SCENARIOS : [opts.scenario];
    for (const id of ids) applyScenario(world, id, tripId);
    assertCannotCloseWithOnBoard(world, tripId);
    finishAll(world);
    worlds.push(world);
  }

  if (opts.scenario === 'all' || group === 'gps' || GPS_SCENARIOS.includes(opts.scenario)) {
    const isolatedFallback = opts.scenario === 'realtime-fallback';
    const world = createWorld('gps', !isolatedFallback, NOW);
    const tripId = gpsTrip(world);
    const ids =
      opts.scenario === 'all' || opts.scenario === 'gps'
        ? GPS_SCENARIOS.filter((id) => id !== 'realtime-fallback')
        : [opts.scenario];
    for (const id of ids) applyScenario(world, id, tripId);
    finishAll(world);
    worlds.push(world);
    if (opts.scenario === 'all' || opts.scenario === 'gps') {
      const fallback = createWorld('rt-fallback', false, NOW);
      const fallbackTrip = gpsTrip(fallback);
      applyScenario(fallback, 'realtime-fallback', fallbackTrip);
      finishAll(fallback);
      worlds.push(fallback);
    }
  }

  if (opts.scenario === 'all' || group === 'load' || opts.scenario === 'tunnel-sync') {
    const world = createWorld('load', true, NOW);
    loadFleet(world, opts.vehicles, opts.students);
    if (opts.scenario === 'all' || opts.scenario === 'load' || opts.scenario === 'tunnel-sync') {
      runLoadStream(world, 8);
    }
    if (opts.scenario === 'all' || opts.scenario === 'tunnel-sync') {
      runTunnelSync(world);
    }
    finishAll(world);
    worlds.push(world);
  }

  return resultOf(opts, worlds);
}

export function formatReport(result: SimResult): string {
  const lines = [
    `simulator ${result.ok ? 'ok' : 'fail'} vehicles=${String(result.vehicles)} students=${String(result.students)} scenario=${result.scenario}`,
    'invariants:',
    ...Object.entries(result.invariants).map(([key, ok]) => `  ${key}: ${ok ? 'pass' : 'FAIL'}`),
    'scale:',
    `  gps_packets: ${String(result.scale.gpsPackets)}`,
    `  realtime_messages: ${String(result.scale.realtimeMessages)}`,
    `  routes_baseline_requests: ${String(result.scale.routesBaselineRequests)}`,
    `  routes_refresh_calls: ${String(result.scale.routesRefreshCalls)}`,
    `  calls_per_trip: ${result.scale.callsPerTrip.toFixed(3)}`,
    `  eta_mae_sec: ${result.scale.etaMaeSec === null ? 'n/a' : result.scale.etaMaeSec.toFixed(1)}`,
    `  eta_p95_sec: ${result.scale.etaP95Sec === null ? 'n/a' : result.scale.etaP95Sec.toFixed(1)}`,
  ];
  if (result.failures.length > 0) {
    lines.push('failures:');
    for (const item of result.failures) lines.push(`  - ${item}`);
  }
  for (const item of result.notes) lines.push(`note: ${item}`);
  lines.push('');
  return lines.join('\n');
}
