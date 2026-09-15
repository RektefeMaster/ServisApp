import { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { createDbFromSql, createSql } from '@servisapp/db';
import { loadEnv } from './env.js';
import {
  HORIZON_QUEUE,
  REPAIR_QUEUE,
  runTripHorizonJob,
  runTripRepairJob,
} from './jobs/horizon.js';
import { LIFECYCLE_QUEUE, runTripLifecycleJob } from './jobs/lifecycle.js';
import { OUTBOX_QUEUE, runOutboxJob } from './jobs/outbox.js';
import { createExpoPushSender, createNetgsmSender } from './notify/senders.js';
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

/**
 * Kuyruk işinin hatası GÖRÜNÜR olmak zorundadır.
 *
 * Eskiden her handler hatayı ya yutuyor ya da yalnız `log.warn` ile geçiyordu.
 * Üç sonucu birden vardı: pg-boss işi başarılı sayıyor (`retryLimit` ölü kod),
 * Sentry hiçbir şey görmüyor, geriye kimsenin bakmadığı tek bir log satırı
 * kalıyordu. 18:00 ufuk işi bir kiracı için patlarsa, bunu sabah 06:40'ta
 * şoför keşfeder — 18:00'in seçilme sebebi tam olarak bunu önlemekti (SPEC §12).
 *
 * Artık hata Sentry'ye gider ve yeniden fırlatılır: pg-boss yeniden dener.
 */
async function runJob(queue: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    log.error({ err: error, queue }, 'kuyruk işi başarısız');
    Sentry.captureException(error, { tags: { queue } });
    throw error;
  }
}

/**
 * Kısmi başarısızlık da başarısızlıktır: tek kiracının seferi üretilmediyse
 * o kiracıda ertesi sabah sefer yoktur. Sayaç loglanır, iş yine de patlar.
 */
class JobPartialFailure extends Error {
  constructor(queue: string, failed: number, cause?: string) {
    super(`${queue}: ${String(failed)} kiracı başarısız${cause ? ` — ${cause}` : ''}`);
    this.name = 'JobPartialFailure';
  }
}

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
  await boss.createQueue(OUTBOX_QUEUE, { retryLimit: 2, notify: true });
  await boss.createQueue(LIFECYCLE_QUEUE, { retryLimit: 2, notify: true });

  await boss.work(PARTITION_QUEUE, async (_jobs) => {
    await runJob(PARTITION_QUEUE, async () => {
      await sql`select ensure_month_partitions()`;
      log.info('partition bakimi tamam');
    });
  });
  await boss.work(HORIZON_QUEUE, async (_jobs) => {
    await runJob(HORIZON_QUEUE, async () => {
      const result = await runTripHorizonJob(sql, db);
      if (result.failed > 0) {
        log.error(result, 'sefer ufku kısmi hata');
        throw new JobPartialFailure(HORIZON_QUEUE, result.failed, result.lastError);
      }
      log.info(result, 'sefer ufku üretildi');
    });
  });
  await boss.work(REPAIR_QUEUE, async (_jobs) => {
    await runJob(REPAIR_QUEUE, async () => {
      const result = await runTripRepairJob(sql, db);
      if (result.failed > 0) {
        log.error(result, 'sefer onarımı kısmi hata');
        throw new JobPartialFailure(REPAIR_QUEUE, result.failed, result.lastError);
      }
      // `blocked` hata değil: araçtaki çocuk yüzünden plana çekilemeyen sefer
      // beklenen sonuçtur, yeniden denemek düzeltmez — ama görünür kalmalı.
      if (result.blocked > 0) log.warn(result, 'sefer onarımı bloklandı');
      else log.info(result, 'sefer onarıldı');
    });
  });
  await boss.work(LIFECYCLE_QUEUE, async (_jobs) => {
    await runJob(LIFECYCLE_QUEUE, async () => {
      const result = await runTripLifecycleJob(sql);
      if (result.expiredOverrides > 0 || result.autoClosedTrips > 0) {
        log.info(result, 'sefer yaşam döngüsü');
      }
    });
  });
  const push = createExpoPushSender();
  const sms = createNetgsmSender({
    usercode: env.NETGSM_USERCODE,
    password: env.NETGSM_PASSWORD,
    msgheader: env.NETGSM_MSGHEADER,
  });
  if (!sms) log.warn('Netgsm yok; davet ve OTP SMS kuyrukta kalır');
  await boss.work(OUTBOX_QUEUE, async (_jobs) => {
    await runJob(OUTBOX_QUEUE, async () => {
      const result = await runOutboxJob(sql, {
        encryptionKey: env.OTP_ENCRYPTION_KEY,
        push,
        sms,
      });
      // `failed` burada sistem hatası DEĞİL: kalıcı teslim başarısızlığı
      // (24 saati geçmiş satır, geçersiz push jetonu) beklenen sonuçtur ve
      // yeniden denemek düzeltmez. Fırlatmak kuyruğu boşuna döndürürdü.
      // Gerçek hata (DB, kiracı listesi) zaten runJob'a düşer.
      if (result.failed > 0) log.warn(result, 'bildirim outbox kısmi hata');
      else if (result.notifications > 0 || result.inviteSms > 0) {
        log.info(result, 'bildirim outbox');
      }
    });
  });

  await boss.schedule(PARTITION_QUEUE, '15 3 1 * *');
  await boss.schedule(HORIZON_QUEUE, '0 18 * * *', {}, { tz: 'Europe/Istanbul' });
  await boss.schedule(REPAIR_QUEUE, '0 4 * * *', {}, { tz: 'Europe/Istanbul' });
  await boss.schedule(LIFECYCLE_QUEUE, '15 * * * *', {}, { tz: 'Europe/Istanbul' });
  await boss.schedule(OUTBOX_QUEUE, '* * * * *');
  await boss.send(PARTITION_QUEUE, null, { singletonKey: 'boot', singletonSeconds: 3_600 });
  await boss.send(LIFECYCLE_QUEUE, null, { singletonKey: 'boot', singletonSeconds: 60 });
  await boss.send(OUTBOX_QUEUE, null, { singletonKey: 'boot', singletonSeconds: 30 });
  setInterval(() => {
    void boss.send(OUTBOX_QUEUE, null, { singletonKey: 'tick', singletonSeconds: 15 });
  }, 15_000);
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
