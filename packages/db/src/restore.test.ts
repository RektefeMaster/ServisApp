import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asApi, insertWorld } from './test/fixture.js';
import { startHarness, stopHarness, type Harness } from './test/harness.js';

function databaseUrl(base: string, name: string): string {
  const parsed = new URL(base);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function execOk(harness: Harness, command: string[]): Promise<void> {
  const result = await harness.container.exec(command);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(' ')} exit ${String(result.exitCode)}\n${result.stderr}\n${result.stdout}`,
    );
  }
}

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 120_000);

afterAll(async () => {
  if (harness) await stopHarness(harness);
});

describe('restore provası', () => {
  it('pg_dump yeni veritabanına yüklenir; ON_BOARD kapanışı ve event UPDATE hâlâ durur', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      insert into event (tenant_id, trip_id, subject_type, subject_id, event_type)
      values (${world.tenantA}, ${world.tripId}, 'TRIP', ${world.tripId}, 'TRIP_STARTED')
    `;
    await harness.sql`
      update trip_student set state = 'ON_BOARD', state_seq = 1
      where id = ${world.tripStudentId}
    `;
    await harness.sql`
      insert into trip_vehicle_check (tenant_id, trip_id, phase, checked_by, vehicle_empty_confirmed)
      values (${world.tenantA}, ${world.tripId}, 'AFTER', ${world.membershipId}, true)
    `;

    await execOk(harness, [
      'pg_dump',
      '-U',
      'postgres',
      '--no-owner',
      '-f',
      '/tmp/servisapp.dump.sql',
      'servisapp',
    ]);
    await execOk(harness, [
      'psql',
      '-U',
      'postgres',
      '-c',
      'DROP DATABASE IF EXISTS restore_target WITH (FORCE);',
    ]);
    await execOk(harness, ['psql', '-U', 'postgres', '-c', 'CREATE DATABASE restore_target;']);
    await execOk(harness, [
      'psql',
      '-U',
      'postgres',
      '-d',
      'restore_target',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '/tmp/servisapp.dump.sql',
    ]);
    await harness.sql.unsafe('grant connect on database restore_target to servisapp_api');

    const restoredSql = postgres(databaseUrl(harness.url, 'restore_target'), {
      max: 2,
      prepare: false,
      onnotice: () => {},
    });
    try {
      const [trip] = await restoredSql<{ state: string }[]>`
        select state from trip where id = ${world.tripId}
      `;
      expect(trip?.state).toBe('ACTIVE');

      const [events] = await restoredSql<{ count: string }[]>`
        select count(*)::text as count from event where trip_id = ${world.tripId}
      `;
      expect(Number(events?.count)).toBeGreaterThanOrEqual(1);

      const [settings] = await restoredSql<{ kill_gps: boolean }[]>`
        select kill_gps from platform_settings where id = true
      `;
      expect(settings?.kill_gps).toBe(false);

      await expect(
        asApi(restoredSql, world.tenantA, (tx) => tx`select complete_trip(${world.tripId}::uuid)`),
      ).rejects.toThrow(/students_still_on_trip/);

      await expect(
        asApi(restoredSql, world.tenantA, (tx) => tx`update event set event_type = 'HACK'`),
      ).rejects.toThrow(/permission denied|event_is_append_only/);
    } finally {
      await restoredSql.end({ timeout: 5 });
    }
  });
});
