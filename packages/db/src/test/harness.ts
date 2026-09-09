import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { applyMigrations } from '../migrate-files.js';

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

export interface Harness {
  url: string;
  sql: Sql;
  container: StartedPostgreSqlContainer;
}

export async function startHarness(): Promise<Harness> {
  configureDockerRuntime();
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('servisapp')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
  const url = container.getConnectionUri();
  await applyMigrations(url);
  const sql = postgres(url, { max: 6, prepare: false, onnotice: () => {} });
  return { url, sql, container };
}

export async function stopHarness(harness: Harness): Promise<void> {
  await harness.sql.end({ timeout: 5 });
  await harness.container.stop();
}
