import { describe, expect, it } from 'vitest';
import {
  assignTripCrewInput,
  assignTripVehicleInput,
  createStudentTripMoveInput,
  undoStudentCommandInput,
} from './trip.js';

describe('operasyon sözleşmesi', () => {
  it('sefer ataması gerekçe ister', () => {
    expect(() =>
      assignTripVehicleInput.parse({
        vehicleId: '00000000-0000-4000-8000-000000000001',
        reason: 'ab',
      }),
    ).toThrow();
    expect(
      assignTripCrewInput.parse({
        role: 'DRIVER',
        membershipId: '00000000-0000-4000-8000-000000000002',
        reason: 'Şoför değişimi',
      }).role,
    ).toBe('DRIVER');
  });

  it('öğrenci transferi aynı gün ve segment taşır', () => {
    const parsed = createStudentTripMoveInput.parse({
      studentId: '00000000-0000-4000-8000-000000000003',
      serviceDate: '2026-09-25',
      segment: 'MORNING',
      targetRouteId: '00000000-0000-4000-8000-000000000004',
      reason: 'Okul değişimi yok; araç değişti',
    });
    expect(parsed.segment).toBe('MORNING');
  });

  it('geri alma hedef komut kimliğini ister', () => {
    const parsed = undoStudentCommandInput.parse({
      clientEventId: '00000000-0000-4000-8000-000000000005',
      targetClientEventId: '00000000-0000-4000-8000-000000000006',
      tripStudentId: '00000000-0000-4000-8000-000000000007',
    });
    expect(parsed.targetClientEventId).toBe('00000000-0000-4000-8000-000000000006');
  });
});
