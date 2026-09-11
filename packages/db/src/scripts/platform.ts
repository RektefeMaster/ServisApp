/**
 * Kill switch ve min app sürümü. API rolü platform_settings UPDATE edemez;
 * bu yüzden migration bağlantısı (postgres) kullanılır.
 *
 *   pnpm db:platform -- --kill-gps=true
 *   pnpm db:platform -- --kill-otp=false --kill-realtime=true
 *   pnpm db:platform -- --min-app-version=1.2.0
 */
import { parseArgs } from 'node:util';
import postgres from 'postgres';

const FLAG = /^(true|false|on|off|1|0)$/i;
const SEMVER = /^\d+\.\d+\.\d+$/;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} tanımlı değil`);
  return value;
}

function parseFlag(raw: string | undefined, label: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (!FLAG.test(raw)) throw new Error(`${label} true|false|on|off olmalı`);
  return ['true', 'on', '1'].includes(raw.toLowerCase());
}

interface PlatformPatch {
  killGps?: boolean;
  killOtp?: boolean;
  killRealtime?: boolean;
  minSupportedAppVersion?: string;
}

function parsePlatformArgs(argv: string[]): PlatformPatch {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== '--'),
    options: {
      'kill-gps': { type: 'string' },
      'kill-otp': { type: 'string' },
      'kill-realtime': { type: 'string' },
      'min-app-version': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const min = values['min-app-version'];
  if (min !== undefined && !SEMVER.test(min)) {
    throw new Error('--min-app-version x.y.z olmalı');
  }
  const patch: PlatformPatch = {
    killGps: parseFlag(values['kill-gps'], '--kill-gps'),
    killOtp: parseFlag(values['kill-otp'], '--kill-otp'),
    killRealtime: parseFlag(values['kill-realtime'], '--kill-realtime'),
    minSupportedAppVersion: min,
  };
  if (
    patch.killGps === undefined &&
    patch.killOtp === undefined &&
    patch.killRealtime === undefined &&
    patch.minSupportedAppVersion === undefined
  ) {
    throw new Error('en az bir bayrak verin');
  }
  return patch;
}

async function main(): Promise<void> {
  const patch = parsePlatformArgs(process.argv.slice(2));
  const sql = postgres(requireEnv('MIGRATION_DATABASE_URL'), { max: 1 });
  try {
    const [row] = await sql<
      {
        kill_gps: boolean;
        kill_otp: boolean;
        kill_realtime: boolean;
        min_supported_app_version: string;
      }[]
    >`
      update platform_settings
      set
        kill_gps = coalesce(${patch.killGps ?? null}::boolean, kill_gps),
        kill_otp = coalesce(${patch.killOtp ?? null}::boolean, kill_otp),
        kill_realtime = coalesce(${patch.killRealtime ?? null}::boolean, kill_realtime),
        min_supported_app_version = coalesce(
          ${patch.minSupportedAppVersion ?? null}::text,
          min_supported_app_version
        ),
        updated_at = now()
      where id = true
      returning kill_gps, kill_otp, kill_realtime, min_supported_app_version
    `;
    if (!row) throw new Error('platform_settings satırı yok');
    console.log(
      `kill_gps=${String(row.kill_gps)} kill_otp=${String(row.kill_otp)} kill_realtime=${String(row.kill_realtime)} min_app=${row.min_supported_app_version}`,
    );
  } finally {
    await sql.end();
  }
}

await main();
