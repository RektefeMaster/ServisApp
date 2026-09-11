import { describe, expect, it } from 'vitest';
import {
  adminDeliveryOverrideView,
  createDeliveryOverrideInput,
  createRideExceptionInput,
  parentDayQuery,
  verifyDeliveryOtpInput,
} from './exceptions.js';

describe('istisna sözleşmesi', () => {
  it('iki segmenti kabul eder, boş listeyi reddeder', () => {
    expect(
      createRideExceptionInput.parse({
        studentId: '00000000-0000-4000-8000-000000000001',
        serviceDate: '2026-09-11',
        segments: ['MORNING', 'AFTERNOON'],
      }).segments,
    ).toEqual(['MORNING', 'AFTERNOON']);
    expect(() =>
      createRideExceptionInput.parse({
        studentId: '00000000-0000-4000-8000-000000000001',
        serviceDate: '2026-09-11',
        segments: [],
      }),
    ).toThrow();
  });

  it('farklı teslimatta E.164 telefon ve pin ister', () => {
    const parsed = createDeliveryOverrideInput.parse({
      studentId: '00000000-0000-4000-8000-000000000001',
      serviceDate: '2026-09-11',
      lat: 40.98,
      lng: 29.05,
      addressText: 'Caferağa mahallesi deneme',
      receiverName: 'Mehmet Demir',
      receiverPhone: '+905321110099',
    });
    expect(parsed.receiverPhone).toBe('+905321110099');
  });

  it('OTP kodu yalnız 6 hanedir', () => {
    expect(() =>
      verifyDeliveryOtpInput.parse({
        tripStudentId: '00000000-0000-4000-8000-000000000002',
        code: '12a456',
      }),
    ).toThrow();
    expect(
      verifyDeliveryOtpInput.parse({
        tripStudentId: '00000000-0000-4000-8000-000000000002',
        code: '123456',
      }).code,
    ).toBe('123456');
  });

  it('gün planı tarihi isteğe bağlıdır; yönetici görünümünde otpCode yoktur', () => {
    expect(parentDayQuery.parse({}).date).toBeUndefined();
    expect(parentDayQuery.parse({ date: '2026-09-22' }).date).toBe('2026-09-22');
    const parsed = adminDeliveryOverrideView.parse({
      id: '00000000-0000-4000-8000-000000000001',
      studentId: '00000000-0000-4000-8000-000000000001',
      studentName: 'Efe Demir',
      serviceDate: '2026-09-22',
      status: 'ACTIVE',
      receiverName: 'Mehmet Demir',
      addressText: 'Erenköy Mah.',
      detourM: 80,
      maxDetourM: 1500,
      otpCode: '123456',
    });
    expect(parsed).not.toHaveProperty('otpCode');
  });
});
