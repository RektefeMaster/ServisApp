import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { createDbFromSql, createSql } from '@servisapp/db';
import { loadEnv } from './env.js';
import { HORIZON_QUEUE, REPAIR_QUEUE, runTripHorizonJob } from './jobs/horizon.js';
import { initObservability, Sentry } from './observability.js';

const PARTITION_QUEUE = 'maintenance.partition';

const env = loadEnv();
initObservability(env);

const log = pino({
  level: env.LOG_LEVEL,
  redact: { paths: ['*.password', '*.phone'], censor: '[gizlendi]' },
});

const sql = createSql(env.WORKER_DATABASE_URL, 'worker');
const db = createDbFromSql(sql);

const boss = new PgBoss({
  connectionString: env.WORKER_DATABASE_URL,
  schema: 'pgboss',
  max: 4,
  application_name: 'servisapp-worker',
  // Session pooler (5432) gerekir; transaction pooler LISTEN taşımaz.
  useListenNotify: true,
});

boss.on('error', (error: unknown) => {
  log.error({ err: error }, 'pg-boss hata');
});
boss.on('warning', (warning: unknown) => {
  log.warn({ warning }, 'pg-boss uyari');
});

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'worker kapanış başlıyor');
  try {
    await boss.stop({ graceful: true, timeout: 15_000 });
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (error) {
    log.error({ err: error }, 'worker kapanış başarısız');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}

try {
  await boss.start();
  await boss.createQueue(PARTITION_QUEUE, { retryLimit: 3, notify: true });
  await boss.createQueue(HORIZON_QUEUE, { retryLimit: 3, notify: true });
  await boss.createQueue(REPAIR_QUEUE, { retryLimit: 3, notify: true });

  await boss.work(PARTITION_QUEUE, async (_jobs) => {
    await sql`select ensure_month_partitions()`;
    log.info('partition bakimi tamam');
  });
  await boss.work(HORIZON_QUEUE, async (_jobs) => {
    const result = await runTripHorizonJob(sql, db);
    if (result.failed > 0) log.warn(result, 'sefer ufku kısmi hata');
    else log.info(result, 'sefer ufku üretildi');
  });
  await boss.work(REPAIR_QUEUE, async (_jobs) => {
    const result = await runTripHorizonJob(sql, db);
    if (result.failed > 0) log.warn(result, 'sefer ufku kısmi hata');
    else log.info(result, 'sefer ufku onarıldı');
  });

  await boss.schedule(PARTITION_QUEUE, '15 3 1 * *');
  await boss.schedule(HORIZON_QUEUE, '0 18 * * *', {}, { tz: 'Europe/Istanbul' });
  await boss.schedule(REPAIR_QUEUE, '0 4 * * *', {}, { tz: 'Europe/Istanbul' });
  await boss.send(PARTITION_QUEUE, null, { singletonKey: 'boot', singletonSeconds: 3_600 });
  log.info('worker ayakta');
} catch (error) {
  log.fatal({ err: error }, 'worker başlatılamadı');
  Sentry.captureException(error);
  try {
    await boss.stop({ graceful: false, timeout: 5_000 });
  } catch (stopError) {
    log.warn({ err: stopError }, 'worker durdurulamadı');
  }
  await Sentry.flush(2_000);
  await sql.end({ timeout: 5 });
  process.exit(1);
}
