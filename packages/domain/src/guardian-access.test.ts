import { describe, expect, it } from 'vitest';
import { canReadGuardianChild } from './guardian-access.js';

describe('veli çocuk erişimi', () => {
  it('üyelik ACTIVE olsa bile ilişki yoksa çocuk okunmaz', () => {
    expect(
      canReadGuardianChild({
        membershipStatus: 'ACTIVE',
        guardianRelationStatus: 'REVOKED',
        studentEnded: false,
      }),
    ).toBe(false);
  });

  it('aktif üyelik ve aktif ilişki ile çocuk okunur', () => {
    expect(
      canReadGuardianChild({
        membershipStatus: 'ACTIVE',
        guardianRelationStatus: 'ACTIVE',
        studentEnded: false,
      }),
    ).toBe(true);
  });

  it('INVITED üyelik tenant’a tam erişim sayılmaz', () => {
    expect(
      canReadGuardianChild({
        membershipStatus: 'INVITED',
        guardianRelationStatus: 'ACTIVE',
        studentEnded: false,
      }),
    ).toBe(false);
  });

  it('kaydı bitmiş öğrenciyi gizler', () => {
    expect(
      canReadGuardianChild({
        membershipStatus: 'ACTIVE',
        guardianRelationStatus: 'ACTIVE',
        studentEnded: true,
      }),
    ).toBe(false);
  });
});
