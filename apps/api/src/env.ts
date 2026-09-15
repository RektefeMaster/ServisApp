import { z } from 'zod';

/**
 * Ortam değişkenleri süreç başlarken doğrulanır. Eksik bir secret'ı çalışma
 * anında keşfetmek yerine açılışta patlamak istiyoruz — sefer ortasında
 * "OTP_PEPPER undefined" hatası kabul edilemez.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  WORKER_DATABASE_URL: z.string().min(1),

  SUPABASE_URL: z.url(),
  // Hosted proje ES256 imza anahtarı kullanıyorsa boş bırakılır; HS256 secret uydurulmaz.
  SUPABASE_JWT_SECRET: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().min(16).optional(),
  ),

  // Kriptografik sırlar yalnız burada yaşar; DB bunları asla görmez (SPEC §5).
  OTP_PEPPER: z.string().min(32),
  OTP_ENCRYPTION_KEY: z.string().min(32),

  SENTRY_DSN: z.string().optional(),
  // Tarayıcıdaki admin paneli (Next). Mobil CORS kullanmaz. Boşsa CORS kapalı kalır.
  ADMIN_ORIGINS: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().optional(),
  ),
  ADMIN_PUBLIC_URL: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.url().optional(),
  ),
  // Yalnız yerel Expo: personel uygulaması hosted Auth olmadan e-posta + bu parola ile girer.
  DEV_LOGIN_PASSWORD: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().min(16).optional(),
  ),
  GOOGLE_MAPS_API_KEY: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().min(8).optional(),
  ),
  NETGSM_USERCODE: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().min(1).optional(),
  ),
  NETGSM_PASSWORD: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().min(1).optional(),
  ),
  NETGSM_MSGHEADER: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().min(1).optional(),
  ),
  /**
   * Platformun YAZDIĞI istemci IP başlığı (ör. Fly'da `fly-client-ip`).
   *
   * Vekil arkasında `request.ip` her istek için vekilin adresidir; IP tabanlı
   * bütün sınırlar (sahte jeton sayacı, `/v1/config`, davet önizlemesi) tek bir
   * kovaya düşer. Bir saldırganın 40 hatalı jetonu bütün velileri 429'a
   * kilitleyebiliyordu. Fly Proxy `Fly-Client-IP`'yi kendi yazar ve istemciden
   * gelenin üstüne biner; bu yüzden CIDR tahmin etmek yerine başlık adı
   * yapılandırılır. Uygulama YALNIZ vekil üzerinden erişilebiliyorsa doldurun.
   */
  CLIENT_IP_HEADER: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim().toLowerCase();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/, 'CLIENT_IP_HEADER yalnız harf, rakam ve tire içerir')
      .optional(),
  ),
  /**
   * Güvenilen vekil IP/CIDR listesi. `true`, `1` ve hop-count (sayı) reddedilir:
   * Fastify CVE-2026-16732 hop-count XFF sahteciliğine izin verir.
   */
  TRUST_PROXY: z.preprocess((value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (
      trimmed.length === 0 ||
      trimmed === 'true' ||
      trimmed === 'false' ||
      trimmed === '1' ||
      trimmed === '0' ||
      /^\d+$/.test(trimmed)
    ) {
      return undefined;
    }
    return trimmed;
  }, z.string().optional()),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Ortam değişkenleri geçersiz:\n${issues}`);
  }
  return result.data;
}
