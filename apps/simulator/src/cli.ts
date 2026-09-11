import { parseArgs } from 'node:util';
import { exhaustive } from '@servisapp/domain';

export const SCENARIO_IDS = [
  'all',
  'ops',
  'gps',
  'load',
  'weak-network',
  'gps-loss',
  'crash',
  'double-tap',
  'crew-race',
  'unordered-replay',
  'last-minute-cancel',
  'temp-delivery',
  'otp-lock',
  'mid-trip-swap',
  'tunnel-sync',
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
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const MAX_VEHICLES = 200;
export const MAX_STUDENTS = 80;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface SimOptions {
  vehicles: number;
  students: number;
  scenario: ScenarioId;
}

export function isScenarioId(value: string): value is ScenarioId {
  return (SCENARIO_IDS as readonly string[]).includes(value);
}

function parseCount(raw: string, label: string, max: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`${label} pozitif tam sayı olmalı`);
  }
  if (value > max) {
    throw new UsageError(`${label} en fazla ${String(max)}`);
  }
  return value;
}

export function parseCli(argv: string[]): SimOptions {
  const args = argv.filter((arg) => arg !== '--');
  let values: { vehicles?: string; students?: string; scenario?: string };
  try {
    const parsed = parseArgs({
      args,
      options: {
        vehicles: { type: 'string', default: '1' },
        students: { type: 'string', default: '40' },
        scenario: { type: 'string', default: 'all' },
      },
      strict: true,
      allowPositionals: false,
    });
    values = parsed.values;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'argüman okunamadı';
    throw new UsageError(message);
  }

  const scenarioRaw = values.scenario ?? 'all';
  if (!isScenarioId(scenarioRaw)) {
    throw new UsageError(
      `bilinmeyen senaryo "${scenarioRaw}". Geçerli: ${SCENARIO_IDS.join(', ')}`,
    );
  }

  return {
    vehicles: parseCount(values.vehicles ?? '1', '--vehicles', MAX_VEHICLES),
    students: parseCount(values.students ?? '40', '--students', MAX_STUDENTS),
    scenario: scenarioRaw,
  };
}

export function usageText(): string {
  return [
    'Kullanım: pnpm --filter @servisapp/simulator start -- --vehicles=N --scenario=ID',
    `Senaryolar: ${SCENARIO_IDS.join(', ')}`,
    'SPEC: hiçbir sefer ON_BOARD ile kapanmaz; TEMP doğrulanmadan teslim olmaz;',
    'event güncellenmez; broadcast veli sayısıyla çarpılmaz.',
  ].join('\n');
}

export function scenarioGroup(id: ScenarioId): 'ops' | 'gps' | 'load' | 'all' {
  switch (id) {
    case 'all':
      return 'all';
    case 'ops':
    case 'weak-network':
    case 'gps-loss':
    case 'crash':
    case 'double-tap':
    case 'crew-race':
    case 'unordered-replay':
    case 'last-minute-cancel':
    case 'temp-delivery':
    case 'otp-lock':
    case 'mid-trip-swap':
      return 'ops';
    case 'gps':
    case 'interpolation':
    case 'jitter':
    case 'teleport':
    case 'off-route':
    case 'traffic':
    case 'routes-refresh':
    case 'eta-confidence':
    case 'gps-stale':
    case 'realtime-fallback':
    case 'dual-gps':
      return 'gps';
    case 'load':
    case 'tunnel-sync':
      return 'load';
    default:
      return exhaustive(id, 'scenarioGroup');
  }
}
