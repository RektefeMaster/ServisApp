import { describe, expect, it } from 'vitest';
import { parentCanTrack, sharedTrackingPayload, studentStillTracked } from './tracking-access.js';

describe('parentCanTrack', () => {
  const base = {
    membershipStatus: 'ACTIVE' as const,
    guardianRelationActive: true,
    tripState: 'ACTIVE' as const,
    studentState: 'EXPECTED' as const,
  };

  it('aktif veli + tamamlanmamış öğrenci izleyebilir', () => {
    expect(parentCanTrack(base)).toBe(true);
    expect(parentCanTrack({ ...base, studentState: 'ON_BOARD' })).toBe(true);
  });

  it('üyelik veya ilişki yetmez', () => {
    expect(parentCanTrack({ ...base, membershipStatus: 'INVITED' })).toBe(false);
    expect(parentCanTrack({ ...base, guardianRelationActive: false })).toBe(false);
  });

  it('teslim sonrası ve sefer bitince kapanır', () => {
    expect(parentCanTrack({ ...base, studentState: 'DELIVERED' })).toBe(false);
    expect(parentCanTrack({ ...base, tripState: 'COMPLETED' })).toBe(false);
    expect(studentStillTracked('NO_SHOW')).toBe(false);
  });
});

describe('sharedTrackingPayload', () => {
  it('yalnız ortak araç alanlarını taşır', () => {
    const payload = sharedTrackingPayload({
      vehicleLat: 40.98,
      vehicleLng: 29.03,
      heading: 90,
      recordedAt: '2026-09-11T04:00:00.000Z',
      quality: 'GOOD',
    });
    expect(Object.keys(payload).sort()).toEqual(
      ['heading', 'quality', 'recordedAt', 'vehicleLat', 'vehicleLng'].sort(),
    );
  });
});
