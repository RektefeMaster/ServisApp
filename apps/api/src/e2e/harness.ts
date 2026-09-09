import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { applyMigrations } from '@servisapp/db';
import postgres, { type Sql } from 'postgres';

const ROLE_PASSWORD = 'E2eLocalPassword16x';

/**
 * Colima Docker context'i varsayılan socket'te değil. Testcontainers'ın
 * daemon'u bulması için DOCKER_HOST'u oturumda ayarlıyoruz; CI'da
 * /var/run/docker.sock zaten vardır, dokunulmaz.
 */
function configureDockerRuntime(): void {
  if (process.env['DOCKER_HOST']) return;
  const colimaSock = `${homedir()}/.colima/default/docker.sock`;
  if (existsSync(colimaSock)) {
    process.env['DOCKER_HOST'] = `unix://${colimaSock}`;
    process.env['TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE'] ??= '/var/run/docker.sock';
  }
}

function withRole(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

export interface E2ePostgres {
  url: string;
  sql: Sql;
  apiUrl: string;
  workerUrl: string;
  container: StartedPostgreSqlContainer;
}

async function enableAppLogins(sql: Sql): Promise<void> {
  const [databaseRow] = await sql<{ current_database: string }[]>`select current_database()`;
  if (!databaseRow) throw new Error('current_database() sonuç döndürmedi');
  const database = databaseRow.current_database;

  for (const role of ['servisapp_api', 'servisapp_worker'] as const) {
    await sql.unsafe(`
      alter role ${role} with login nosuperuser nocreatedb nocreaterole
        nobypassrls noinherit password '${ROLE_PASSWORD}';
      grant connect on database "${database}" to ${role};
    `);
  }
}

export async function startE2ePostgres(): Promise<E2ePostgres> {
  configureDockerRuntime();
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('servisapp')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
  const url = container.getConnectionUri();
  await applyMigrations(url);
  const sql = postgres(url, { max: 6, prepare: false, onnotice: () => {} });
  await enableAppLogins(sql);
  return {
    url,
    sql,
    apiUrl: withRole(url, 'servisapp_api', ROLE_PASSWORD),
    workerUrl: withRole(url, 'servisapp_worker', ROLE_PASSWORD),
    container,
  };
}

export async function stopE2ePostgres(harness: E2ePostgres): Promise<void> {
  await harness.sql.end({ timeout: 5 });
  await harness.container.stop();
}
