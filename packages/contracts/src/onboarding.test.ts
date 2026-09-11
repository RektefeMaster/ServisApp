import { describe, expect, it } from 'vitest';
import { createInviteInput } from './onboarding.js';
import { createGuardianInput } from './setup.js';

const membershipId = '00000000-0000-4000-8000-000000000010';
const studentId = '00000000-0000-4000-8000-000000000011';
const identityId = '00000000-0000-4000-8000-000000000012';

describe('onboarding sözleşmesi', () => {
  it('davet gövdesinde studentId taşımaz', () => {
    const parsed = createInviteInput.parse({
      membershipId,
      studentId,
    });
    expect(parsed).toEqual({ membershipId });
  });

  it('aynı telefon farklı isimde reuse kimliği alır', () => {
    const parsed = createGuardianInput.parse({
      fullName: 'Mehmet Demir',
      phone: '+905321110004',
      relation: 'Baba',
      reuseIdentityId: identityId,
    });
    expect(parsed.reuseIdentityId).toBe(identityId);
  });
});
