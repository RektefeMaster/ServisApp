import { describe, expect, it } from 'vitest';
import {
  vehicleComplianceBlock,
  vehicleComplianceMessage,
  vehicleComplianceWarnings,
} from './vehicle-compliance.js';

describe('araç evrakı', () => {
  it('süresi geçmiş muayene seferi engeller', () => {
    expect(
      vehicleComplianceBlock(
        { inspectionExpiry: '2026-08-01', insuranceExpiry: '2027-01-01' },
        '2026-09-12',
      ),
    ).toBe('INSPECTION_EXPIRED');
  });

  it('süresi geçmiş sigorta seferi engeller', () => {
    expect(
      vehicleComplianceBlock(
        { inspectionExpiry: '2027-01-01', insuranceExpiry: '2026-08-01' },
        '2026-09-12',
      ),
    ).toBe('INSURANCE_EXPIRED');
  });

  it('servis gününde biten evrak o gün hâlâ geçerlidir', () => {
    expect(
      vehicleComplianceBlock(
        { inspectionExpiry: '2026-09-12', insuranceExpiry: '2026-09-12' },
        '2026-09-12',
      ),
    ).toBeNull();
  });

  it('kayıt yoksa engel yoktur', () => {
    expect(
      vehicleComplianceBlock({ inspectionExpiry: null, insuranceExpiry: null }, '2026-09-12'),
    ).toBeNull();
  });

  it('yaklaşan bitişi önceden uyarır', () => {
    expect(
      vehicleComplianceWarnings(
        { inspectionExpiry: '2026-09-20', insuranceExpiry: '2027-01-01' },
        '2026-09-12',
      ),
    ).toEqual(['INSPECTION_SOON']);
    expect(
      vehicleComplianceWarnings(
        { inspectionExpiry: '2026-12-01', insuranceExpiry: '2026-12-01' },
        '2026-09-12',
      ),
    ).toEqual([]);
  });

  it('mesaj plakayı taşır', () => {
    expect(vehicleComplianceMessage('INSURANCE_EXPIRED', '34 GNS 142')).toContain('34 GNS 142');
  });
});
