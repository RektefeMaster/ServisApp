import { describe, expect, it } from 'vitest';
import { isEnrollmentEnded } from './enrollment.js';

describe('isEnrollmentEnded', () => {
  it('boş bitiş tarihi bitmemiş demektir', () => {
    expect(isEnrollmentEnded(null, '2026-09-11')).toBe(false);
    expect(isEnrollmentEnded(undefined, '2026-09-11')).toBe(false);
  });

  it('gelecek bitiş bugünü bitirmez; bitiş günü hâlâ aktiftir', () => {
    expect(isEnrollmentEnded('2026-12-31', '2026-09-11')).toBe(false);
    expect(isEnrollmentEnded('2026-09-11', '2026-09-11')).toBe(false);
  });

  it('bitiş gününden sonra ENDED sayılır', () => {
    expect(isEnrollmentEnded('2026-09-10', '2026-09-11')).toBe(true);
  });
});
