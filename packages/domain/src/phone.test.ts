import { describe, expect, it } from 'vitest';
import { toPhoneE164 } from './phone.js';

describe('toPhoneE164', () => {
  it('05xx, 5xx ve +90 biçimlerini E.164 yapar', () => {
    expect(toPhoneE164('0532 123 45 67')).toBe('+905321234567');
    expect(toPhoneE164('5321234567')).toBe('+905321234567');
    expect(toPhoneE164('+90 532 123 45 67')).toBe('+905321234567');
    expect(toPhoneE164('905321234567')).toBe('+905321234567');
  });

  it('geçersiz girdiyi reddeder', () => {
    expect(toPhoneE164('')).toBeNull();
    expect(toPhoneE164('123')).toBeNull();
    expect(toPhoneE164('+0123')).toBeNull();
  });
});
