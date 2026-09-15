import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index.js';
import { startHarness, stopHarness, type Harness } from './test/harness.js';

/**
 * Drizzle şeması ile gerçekten uygulanmış migration'lar aynı şeyi anlatmak
 * zorundadır.
 *
 * Migration'lar elle yazıldığı için şema dosyası "belge" olmaktan çıkıp
 * yalancıya dönüşebiliyor. Nitekim dönmüştü: unique kısıtlar CREATE TABLE
 * içinde adsız tanımlanmış, Postgres onlara `<tablo>_<kolonlar>_key` demiş,
 * şema ise `notification_dedupe` diyordu. Uygulama ihlali ADLA yakaladığı için
 * yinelenen bildirim yutulamıyor, işlem patlıyordu. Bu test o sapmayı
 * migration birleşmeden yakalar.
 */

function isPgTable(value: unknown): value is PgTable {
  return typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value;
}

function declaredTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema)) {
    if (isPgTable(value)) tables.push(value);
  }
  return tables;
}

describe('şema ile migration eşitliği', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await stopHarness(harness);
  });

  it('her tablo ve kolon migration sonrası veritabanında var', async () => {
    const rows = await harness.sql<
      { table_name: string; column_name: string; is_nullable: string }[]
    >`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
    `;
    const byTable = new Map<string, Map<string, boolean>>();
    for (const row of rows) {
      const cols = byTable.get(row.table_name) ?? new Map<string, boolean>();
      cols.set(row.column_name, row.is_nullable === 'NO');
      byTable.set(row.table_name, cols);
    }

    const missing: string[] = [];
    for (const table of declaredTables()) {
      const config = getTableConfig(table);
      const dbCols = byTable.get(config.name);
      if (!dbCols) {
        missing.push(`tablo yok: ${config.name}`);
        continue;
      }
      for (const column of config.columns) {
        const dbNotNull = dbCols.get(column.name);
        if (dbNotNull === undefined) {
          missing.push(`kolon yok: ${config.name}.${column.name}`);
          continue;
        }
        if (dbNotNull !== column.notNull) {
          missing.push(
            `null farkı: ${config.name}.${column.name} şema=${String(column.notNull)} db=${String(dbNotNull)}`,
          );
        }
      }
      for (const name of dbCols.keys()) {
        if (!config.columns.some((column) => column.name === name)) {
          missing.push(`şemada olmayan kolon: ${config.name}.${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('şemada ilan edilen her kısıt ve index adı veritabanında var', async () => {
    const constraintRows = await harness.sql<{ conname: string }[]>`
      select conname from pg_constraint
    `;
    const indexRows = await harness.sql<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'public'
    `;
    const names = new Set([
      ...constraintRows.map((row) => row.conname),
      ...indexRows.map((row) => row.indexname),
    ]);

    const missing: string[] = [];
    for (const table of declaredTables()) {
      const config = getTableConfig(table);
      for (const unique of config.uniqueConstraints) {
        if (unique.name && !names.has(unique.name)) {
          missing.push(`unique yok: ${config.name} -> ${unique.name}`);
        }
      }
      for (const index of config.indexes) {
        const name = index.config.name;
        if (name && !names.has(name)) missing.push(`index yok: ${config.name} -> ${name}`);
      }
      for (const check of config.checks) {
        if (!names.has(check.name)) missing.push(`check yok: ${config.name} -> ${check.name}`);
      }
      for (const fk of config.foreignKeys) {
        const name = fk.getName();
        if (name && !names.has(name)) missing.push(`fk yok: ${config.name} -> ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('uygulamanın adla yakaladığı kısıtlar gerçekten o adla var', async () => {
    // isUniqueViolation(...) çağrılarında geçen adlar. Biri kaybolursa ihlal
    // yutulamaz ve işlem patlar — bu yüzden liste elle ve açıkça tutulur.
    const referenced = [
      'ride_exception_active',
      'delivery_override_active',
      'student_trip_move_unique',
      'trip_route_date',
      'device_pkey',
      'device_tenant_row',
      'pending_command_dependency_pk',
      'notification_dedupe',
      'route_version_one_draft',
      'route_version_one_published',
      'route_stop_stop',
      'guardian_invite_one_pending',
    ];
    const constraintRows = await harness.sql<{ conname: string }[]>`
      select conname from pg_constraint
    `;
    const indexRows = await harness.sql<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'public'
    `;
    const names = new Set([
      ...constraintRows.map((row) => row.conname),
      ...indexRows.map((row) => row.indexname),
    ]);
    expect(referenced.filter((name) => !names.has(name))).toEqual([]);
  });
});
