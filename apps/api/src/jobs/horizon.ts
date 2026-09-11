import { createDbFromSql, type Database } from '@servisapp/db';
import { TRIP_HORIZON_DAYS, ymdInTimeZone } from '@servisapp/domain';
import type postgres from 'postgres';
import { createTripPort } from '../data/trips.js';

export const HORIZON_QUEUE = 'trips.horizon';
export const REPAIR_QUEUE = 'trips.repair';

export async function runTripHorizonJob(
  sql: postgres.Sql,
  db: Database = createDbFromSql(sql),
  now = new Date(),
): Promise<{ tenants: number; created: number; failed: number; lastError?: string }> {
  const tenants = await sql<{ id: string; timezone: string }[]>`
    select * from list_tenants_for_jobs()
  `;
  const trips = createTripPort(db);
  let created = 0;
  let failed = 0;
  let lastError: string | undefined;
  for (const tenant of tenants) {
    try {
      const fromDate = ymdInTimeZone(now, tenant.timezone);
      const result = await trips.generateHorizon(
        tenant.id,
        { membershipId: null, role: 'SYSTEM' },
        { fromDate, days: TRIP_HORIZON_DAYS },
      );
      created += result.created;
    } catch (error) {
      failed += 1;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { tenants: tenants.length, created, failed, ...(lastError ? { lastError } : {}) };
}
