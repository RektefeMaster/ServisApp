import * as Sentry from '@sentry/node';
import type { Env } from './env.js';

/**
 * DSN yoksa sessizce devre dışı kalır — yerel geliştirme ve test için gerekli.
 * Kişisel veri Sentry'ye gitmez: çocuk adı, adres, telefon, OTP.
 *
 * OTLP dışa aktarımı YOKTUR. Docstring bir zamanlar `OTEL_EXPORTER_OTLP_ENDPOINT`
 * dolunca OTLP SDK'nın başladığını söylüyordu; kod o değişkeni hiç okumuyordu.
 * Olmayan bir yeteneği belgelemektense değişken de kaldırıldı: izleme
 * bilinçli olarak Sentry + yapılandırılmış pino log'udur (SPEC §12).
 */
export function initObservability(env: Env): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
    sendDefaultPii: false,
  });
}

export { Sentry };
