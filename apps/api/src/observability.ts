import * as Sentry from '@sentry/node';
import type { Env } from './env.js';

/**
 * DSN yoksa sessizce devre dışı kalır — yerel geliştirme ve test için gerekli.
 */
export function initObservability(env: Env): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
    // Kişisel veri Sentry'ye gitmez: çocuk adı, adres, telefon, OTP.
    sendDefaultPii: false,
  });
}

export { Sentry };
