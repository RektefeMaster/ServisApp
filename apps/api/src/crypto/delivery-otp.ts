import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const CODE_DIGITS = 6;

export function generateDeliveryOtpCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

export function hmacDeliveryOtp(code: string, pepper: string): Buffer {
  return createHmac('sha256', pepper).update(code, 'utf8').digest();
}

export function otpHmacMatches(code: string, pepper: string, stored: Buffer): boolean {
  const candidate = hmacDeliveryOtp(code, pepper);
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

function aesKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** iv(12) + tag(16) + ciphertext. Pepper DB'ye gitmez; bu da gitmez — yalnız ciphertext durur. */
export function encryptDeliveryOtp(code: string, encryptionKey: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey(encryptionKey), iv);
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptDeliveryOtp(payload: Buffer, encryptionKey: string): string {
  if (payload.length < 29) throw new Error('otp_ciphertext_invalid');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', aesKey(encryptionKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
