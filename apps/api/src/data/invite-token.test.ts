import { describe, expect, it } from 'vitest';
import { hashInviteToken, phoneHint } from './invite-token.js';

describe('davet jetonu', () => {
  it('aynı pepper ile aynı hash’i üretir', () => {
    const pepper = 'test-pepper-en-az-otuziki-karakterxxxx';
    expect(hashInviteToken('abc', pepper).equals(hashInviteToken('abc', pepper))).toBe(true);
    expect(hashInviteToken('abc', pepper).equals(hashInviteToken('abd', pepper))).toBe(false);
  });

  it('telefonu tam göstermez', () => {
    expect(phoneHint('+905321110004')).toBe('***0004');
  });
});
