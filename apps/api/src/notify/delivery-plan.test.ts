import { describe, expect, it } from 'vitest';
import { NOTIFICATION_STALE_MS, planNotificationDelivery } from './delivery-plan.js';

describe('bildirim teslim planı', () => {
  it('push token varsa push gider', () => {
    expect(
      planNotificationDelivery({
        channel: 'PUSH',
        hasPushToken: true,
        smsAvailable: true,
        ageMs: 1_000,
      }),
    ).toBe('push');
  });

  it('token yoksa SMS yedekler; Netgsm yoksa kuyrukta kalır', () => {
    expect(
      planNotificationDelivery({
        channel: 'PUSH',
        hasPushToken: false,
        smsAvailable: true,
        ageMs: 1_000,
      }),
    ).toBe('sms');
    expect(
      planNotificationDelivery({
        channel: 'PUSH',
        hasPushToken: false,
        smsAvailable: false,
        ageMs: 1_000,
      }),
    ).toBe('skip');
  });

  it('OTP SMS göndericisiz FAILED yazılmaz', () => {
    expect(
      planNotificationDelivery({
        channel: 'SMS',
        hasPushToken: false,
        smsAvailable: false,
        ageMs: 1_000,
      }),
    ).toBe('skip');
  });

  it('24 saatten eski kuyruk FAILED olur', () => {
    expect(
      planNotificationDelivery({
        channel: 'PUSH',
        hasPushToken: false,
        smsAvailable: false,
        ageMs: NOTIFICATION_STALE_MS,
      }),
    ).toBe('fail');
  });
});
