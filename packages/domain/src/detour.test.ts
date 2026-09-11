import { describe, expect, it } from 'vitest';
import {
  canResendOtp,
  criticalAlertAutoDropped,
  detourDecision,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS,
  otpLockedAfterAttempts,
  reconcileCancelRideException,
} from './detour.js';

describe('detourDecision', () => {
  it('sınır içi otomatik onaylar', () => {
    expect(detourDecision(0, 1500)).toBe('AUTO');
    expect(detourDecision(1500, 1500)).toBe('AUTO');
  });

  it('sınır dışı yönetici onayı ister', () => {
    expect(detourDecision(1501, 1500)).toBe('NEEDS_APPROVAL');
  });

  it('bozuk mesafeyi onaya düşürür', () => {
    expect(detourDecision(Number.NaN, 1500)).toBe('NEEDS_APPROVAL');
    expect(detourDecision(100, -1)).toBe('NEEDS_APPROVAL');
  });
});

describe('OTP kilit / yeniden gönderim', () => {
  it('beşincide kilitler', () => {
    expect(otpLockedAfterAttempts(OTP_MAX_ATTEMPTS - 1)).toBe(false);
    expect(otpLockedAfterAttempts(OTP_MAX_ATTEMPTS)).toBe(true);
  });

  it('yeniden gönderim tavanını tutar', () => {
    expect(canResendOtp(OTP_MAX_RESENDS - 1)).toBe(true);
    expect(canResendOtp(OTP_MAX_RESENDS)).toBe(false);
  });
});

describe('kritik uyarı düşümü', () => {
  it('aktif seferde durak varıldıysa düşer', () => {
    expect(
      criticalAlertAutoDropped({ tripState: 'ACTIVE', stopArrivedAt: new Date() }),
    ).toBe(true);
    expect(criticalAlertAutoDropped({ tripState: 'ACTIVE', stopArrivedAt: null })).toBe(false);
  });

  it('bitmiş seferde uyarı kalmaz', () => {
    expect(criticalAlertAutoDropped({ tripState: 'COMPLETED', stopArrivedAt: null })).toBe(true);
  });
});

describe('istisna iptali', () => {
  it('planlı yokluğu beklenene çevirir', () => {
    expect(reconcileCancelRideException('ABSENT_PLANNED')).toEqual({
      kind: 'APPLY',
      nextState: 'EXPECTED',
    });
  });

  it('araçtaki çocuğu geri almaz', () => {
    expect(reconcileCancelRideException('ON_BOARD')).toEqual({
      kind: 'IGNORE',
      reason: 'OPERATIONAL_FACT_WINS',
    });
  });
});
