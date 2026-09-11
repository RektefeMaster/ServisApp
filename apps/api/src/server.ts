import { createSql } from '@servisapp/db';
import { buildApp } from './app.js';
import { createPostgresData } from './data/postgres.js';
import { loadEnv } from './env.js';
import { initObservability } from './observability.js';

const env = loadEnv();
initObservability(env);

const sql = createSql(env.DATABASE_URL, 'api');
const data = createPostgresData(sql, {
  invitePepper: env.OTP_PEPPER,
  otpEncryptionKey: env.OTP_ENCRYPTION_KEY,
  publicAppUrl: env.ADMIN_PUBLIC_URL ?? '',
  revealInviteSecrets: false,
});

const app = buildApp({
  env,
  data,
  health: {
    checkDatabase: async () => {
      await sql`select 1`;
    },
  },
});

/**
 * Fly makineyi durdururken SIGTERM gönderir. Devam eden istekleri bitirip
 * bağlantıları kapatıyoruz — sefer ortasında yarım kalan bir transaction
 * bırakmak istemiyoruz.
 */
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'kapanış başlıyor');
  try {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'kapanış başarısız');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.fatal({ err: error }, 'sunucu başlatılamadı');
  await sql.end({ timeout: 5 });
  process.exit(1);
}
