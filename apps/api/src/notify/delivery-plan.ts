/** Token yokken sahte FAILED yazılmaz; 24 saatten eski kuyruk bırakılmaz. */
export const NOTIFICATION_STALE_MS = 24 * 60 * 60 * 1000;

export type NotificationDeliveryPlan = 'push' | 'sms' | 'skip' | 'fail';

export function planNotificationDelivery(input: {
  channel: 'PUSH' | 'SMS';
  hasPushToken: boolean;
  smsAvailable: boolean;
  ageMs: number;
}): NotificationDeliveryPlan {
  if (input.ageMs >= NOTIFICATION_STALE_MS) return 'fail';
  if (input.channel === 'SMS') {
    return input.smsAvailable ? 'sms' : 'skip';
  }
  if (input.hasPushToken) return 'push';
  if (input.smsAvailable) return 'sms';
  return 'skip';
}
