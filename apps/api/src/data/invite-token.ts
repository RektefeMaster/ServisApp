import { createHmac, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

export function hashInviteToken(token: string, pepper: string): Buffer {
  return createHmac('sha256', pepper).update(token, 'utf8').digest();
}

export function newInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function phoneHint(phone: string): string {
  if (phone.length < 4) return '****';
  return `***${phone.slice(-4)}`;
}

export function inviteExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
}
