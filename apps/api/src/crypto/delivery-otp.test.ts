import { describe, expect, it } from 'vitest';
import {
  decryptDeliveryOtp,
  encryptDeliveryOtp,
  generateDeliveryOtpCode,
  hmacDeliveryOtp,
  otpHmacMatches,
} from './delivery-otp.js';

const pepper = 'test-pepper-en-az-otuziki-karakterxxxx';
const key = 'test-key-en-az-otuziki-karakter-olmali-x';

describe('teslim OTP kriptosu', () => {
  it('6 haneli kod üretir', () => {
    const code = generateDeliveryOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('HMAC eşleşmesi zaman sabitidir; yanlış kod düşer', () => {
    const stored = hmacDeliveryOtp('123456', pepper);
    expect(otpHmacMatches('123456', pepper, stored)).toBe(true);
    expect(otpHmacMatches('000000', pepper, stored)).toBe(false);
  });

  it('ciphertext çözülünce aynı kod döner; farklı anahtar patlar', () => {
    const packed = encryptDeliveryOtp('654321', key);
    expect(packed.includes(Buffer.from('654321'))).toBe(false);
    expect(decryptDeliveryOtp(packed, key)).toBe('654321');
    expect(() => decryptDeliveryOtp(packed, `${key}x`)).toThrow();
  });
});
