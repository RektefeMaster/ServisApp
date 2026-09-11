import { tooManyRequests } from '../http-error.js';

export const AUTH_FAIL_MAX = 40;
export const AUTH_FAIL_WINDOW_MS = 60_000;
const SWEEP_EVERY_NOTES = 64;

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
  let notes = 0;

  function sweep(at: number): void {
    for (const [ip, stamps] of hits) {
      const recent = stamps.filter((stamp) => at - stamp < windowMs);
      if (recent.length === 0) hits.delete(ip);
      else hits.set(ip, recent);
    }
  }

  return {
    note(ip: string) {
      const at = now();
      notes += 1;
      if (notes % SWEEP_EVERY_NOTES === 0) sweep(at);
      const recent = (hits.get(ip) ?? []).filter((stamp) => at - stamp < windowMs);
      recent.push(at);
      hits.set(ip, recent);
      if (recent.length > max) throw tooManyRequests();
    },
  };
}
