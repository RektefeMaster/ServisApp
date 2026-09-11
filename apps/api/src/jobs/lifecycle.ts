import { createSql } from '@servisapp/db';
import type postgres from 'postgres';

export const LIFECYCLE_QUEUE = 'trips.lifecycle';

export interface LifecycleResult {
  expiredOverrides: number;
  autoClosedTrips: number;
}

export async function runTripLifecycleJob(
  sql: postgres.Sql,
  graceHours = 14,
): Promise<LifecycleResult> {
  const [expired] = await sql<{ count: number }[]>`
    select expire_stale_delivery_overrides() as count
  `;
  const [closed] = await sql<{ count: number }[]>`
    select auto_close_stale_trips(${graceHours}::integer) as count
  `;
  return {
    expiredOverrides: Number(expired?.count ?? 0),
    autoClosedTrips: Number(closed?.count ?? 0),
  };
}

/** Yerel CLI / release için. */
export async function runLifecycleOnce(databaseUrl: string): Promise<LifecycleResult> {
  const sql = createSql(databaseUrl, 'worker');
  try {
    return await runTripLifecycleJob(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
