import { describe, expect, it } from 'vitest';
import { HttpError } from '../http-error.js';
import { createAuthFailLimiter } from './auth-fail-limit.js';

describe('createAuthFailLimiter', () => {
  it('eşikten sonraki denemeyi 429 ile keser', () => {
    const limiter = createAuthFailLimiter({ max: 2, windowMs: 1_000, now: () => 0 });
    limiter.note('10.0.0.1');
    limiter.note('10.0.0.1');
    let thrown: unknown;
    try {
      limiter.note('10.0.0.1');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpError);
    if (thrown instanceof HttpError) {
      expect(thrown.statusCode).toBe(429);
      expect(thrown.code).toBe('rate_limited');
    }
  });

  it('pencere dolunca sayacı sıfırlar; IP’ler birbirini ezmez', () => {
    let t = 0;
    const limiter = createAuthFailLimiter({ max: 1, windowMs: 100, now: () => t });
    limiter.note('10.0.0.1');
    limiter.note('10.0.0.2');
    t = 150;
    limiter.note('10.0.0.1');
  });
});
