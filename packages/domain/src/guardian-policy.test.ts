import { describe, expect, it } from 'vitest';
import {
  canGuardianManageDeliveryOverride,
  canGuardianReceiveChild,
  canGuardianViewDeliveryOtp,
  deliveryNeedsReceiverAttestation,
  shouldNotifyGuardian,
} from './guardian-policy.js';

describe('veli politika', () => {
  it('OTP yalnız yetkili velide', () => {
    expect(
      canGuardianViewDeliveryOtp({ relationActive: true, canAuthorizeTempAddress: false }),
    ).toBe(false);
    expect(
      canGuardianManageDeliveryOverride({ relationActive: true, canAuthorizeTempAddress: true }),
    ).toBe(true);
  });

  it('yaklaşma bildirimi segment tercihine uyar', () => {
    expect(
      shouldNotifyGuardian({
        relationActive: true,
        notifyAm: false,
        notifyPm: true,
        segment: 'MORNING',
      }),
    ).toBe(false);
    expect(
      shouldNotifyGuardian({
        relationActive: true,
        notifyAm: false,
        notifyPm: true,
        segment: 'AFTERNOON',
      }),
    ).toBe(true);
  });

  it('GUARDIAN_REQUIRED ev/temp teslimde alıcı ister', () => {
    expect(
      deliveryNeedsReceiverAttestation({
        handoverPolicy: 'GUARDIAN_REQUIRED',
        deliveryTarget: 'HOME',
      }),
    ).toBe(true);
    expect(
      deliveryNeedsReceiverAttestation({
        handoverPolicy: 'MAY_LEAVE_ALONE',
        deliveryTarget: 'HOME',
      }),
    ).toBe(false);
    expect(
      deliveryNeedsReceiverAttestation({
        handoverPolicy: 'GUARDIAN_REQUIRED',
        deliveryTarget: 'SCHOOL',
      }),
    ).toBe(false);
  });

  it('teslim alan yalnız canReceiveChild', () => {
    expect(canGuardianReceiveChild({ relationActive: true, canReceiveChild: false })).toBe(false);
    expect(canGuardianReceiveChild({ relationActive: true, canReceiveChild: true })).toBe(true);
  });
});
