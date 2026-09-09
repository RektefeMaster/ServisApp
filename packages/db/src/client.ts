import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/**
 * Bağlantı stratejisi (SPEC §3).
 *
 *   api        → transaction pooler + servisapp_api rolü (BYPASSRLS yok)
 *   worker     → ayrı havuz + servisapp_worker rolü
 *   migration  → doğrudan bağlantı, yalnız deploy sırasında
 *
 * Transaction pooler prepared statement'ları desteklemediği için `prepare: false`
 * zorunlu; `SET LOCAL` ise transaction içinde çalıştığından pooler ile güvenlidir.
 */
export type ConnectionKind = 'api' | 'worker' | 'migration';

const POOL_DEFAULTS: Record<ConnectionKind, { max: number; prepare: boolean }> = {
  api: { max: 10, prepare: false },
  worker: { max: 4, prepare: false },
  migration: { max: 1, prepare: true },
};

export function createSql(url: string, kind: ConnectionKind) {
  const defaults = POOL_DEFAULTS[kind];
  return postgres(url, {
    max: defaults.max,
    prepare: defaults.prepare,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });
}

export function createDbFromSql(client: ReturnType<typeof createSql>) {
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDbFromSql>;

export function createDb(url: string, kind: ConnectionKind): Database {
  return createDbFromSql(createSql(url, kind));
}
