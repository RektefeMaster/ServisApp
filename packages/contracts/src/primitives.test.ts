import { describe, expect, it } from 'vitest';
import { coordinate, phoneE164, serviceDate } from './primitives.js';

describe('primitives', () => {
  it('E.164 telefonu kabul eder, yerel biçimi reddeder', () => {
    expect(phoneE164.safeParse('+905321234567').success).toBe(true);
    expect(phoneE164.safeParse('05321234567').success).toBe(false);
  });

  it('servis gününü takvim günü olarak doğrular', () => {
    expect(serviceDate.safeParse('2026-09-08').success).toBe(true);
    expect(serviceDate.safeParse('2026-09-08T07:10:00Z').success).toBe(false);
  });

  it('geçersiz koordinatı reddeder', () => {
    expect(coordinate.safeParse({ lat: 41.0, lng: 29.0 }).success).toBe(true);
    expect(coordinate.safeParse({ lat: 91, lng: 29 }).success).toBe(false);
  });
});
