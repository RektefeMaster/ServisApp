import { tooManyRequests } from '../http-error.js';

export const AUTH_FAIL_MAX = 40;
export const AUTH_FAIL_WINDOW_MS = 60_000;

export interface AuthFailLimiter {
  /** Geçersiz oturum denemesini kaydeder; eşik aşılırsa 429. */
  note(ip: string): void;
}

/**
 * Auth onRequest 401 fırlatınca @fastify/rate-limit çalışmaz.
 * Sahte jeton denemeleri IP başına pencerede sınırlanır.
 */
export function createAuthFailLimiter(
  options: { max?: number; windowMs?: number; now?: () => number } = {},
): AuthFailLimiter {
  const max = options.max ?? AUTH_FAIL_MAX;
  const windowMs = options.windowMs ?? AUTH_FAIL_WINDOW_MS;
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();

  return {
    note(ip: string) {
      const at = now();
      const recent = (hits.get(ip) ?? []).filter((stamp) => at - stamp < windowMs);
      recent.push(at);
      hits.set(ip, recent);
      if (recent.length > max) throw tooManyRequests();
    },
  };
}
