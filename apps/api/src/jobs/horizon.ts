import { createDbFromSql, withTenant, type Database } from '@servisapp/db';
import { TRIP_HORIZON_DAYS, ymdInTimeZone } from '@servisapp/domain';
import type postgres from 'postgres';
import { reconcileOpenTripsTx, type TripReconcileResult } from '../data/trip-reconcile.js';
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

/**
 * Onarım işi ufku doldurmakla yetinmez. Üretilmiş sefer kendi anlığını taşıdığı
 * için, plan sonradan değiştiğinde (yeni rota sürümü, sonradan ilan edilen
 * tatil) o anlık kendiliğinden düzelmez. Önce henüz başlamamış seferler yetkili
 * plana çekilir, sonra eksik günler üretilir.
 */
export async function runTripRepairJob(
  sql: postgres.Sql,
  db: Database = createDbFromSql(sql),
  now = new Date(),
): Promise<{
  tenants: number;
  created: number;
  failed: number;
  rebuilt: number;
  cancelled: number;
  blocked: number;
  lastError?: string;
}> {
  const tenants = await sql<{ id: string; timezone: string }[]>`
    select * from list_tenants_for_jobs()
  `;
  let rebuilt = 0;
  let cancelled = 0;
  let blocked = 0;
  let failed = 0;
  let lastError: string | undefined;
  for (const tenant of tenants) {
    try {
      const result: TripReconcileResult = await withTenant(
        db,
        { tenantId: tenant.id, membershipId: null, role: 'SYSTEM' },
        (tx) => reconcileOpenTripsTx(tx, tenant.id),
      );
      rebuilt += result.rebuilt;
      cancelled += result.cancelled;
      blocked += result.blocked.length;
    } catch (error) {
      failed += 1;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  const horizon = await runTripHorizonJob(sql, db, now);
  failed += horizon.failed;
  if (horizon.lastError) lastError = horizon.lastError;
  return {
    tenants: tenants.length,
    created: horizon.created,
    failed,
    rebuilt,
    cancelled,
    blocked,
    ...(lastError ? { lastError } : {}),
  };
}
