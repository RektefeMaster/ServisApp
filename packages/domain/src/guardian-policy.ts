import type { HandoverPolicy } from './student-state-machine.js';

export type { HandoverPolicy };
export type TripSegment = 'MORNING' | 'AFTERNOON';

/** Farklı teslim OTP’sini yalnız yetkili veli görür / yönetir. */
export function canGuardianManageDeliveryOverride(input: {
  relationActive: boolean;
  canAuthorizeTempAddress: boolean;
}): boolean {
  return input.relationActive && input.canAuthorizeTempAddress;
}

export function canGuardianViewDeliveryOtp(input: {
  relationActive: boolean;
  canAuthorizeTempAddress: boolean;
}): boolean {
  return canGuardianManageDeliveryOverride(input);
}

export function shouldNotifyGuardian(input: {
  relationActive: boolean;
  notifyAm: boolean;
  notifyPm: boolean;
  segment: TripSegment;
}): boolean {
  if (!input.relationActive) return false;
  switch (input.segment) {
    case 'MORNING':
      return input.notifyAm;
    case 'AFTERNOON':
      return input.notifyPm;
    default: {
      const unexpected: never = input.segment;
      return unexpected;
    }
  }
}

/** Kapıda bırakma: yalnız MAY_LEAVE_ALONE tek dokunuş; aksi halde yetkili alıcı gerekir. */
export function deliveryNeedsReceiverAttestation(input: {
  handoverPolicy: HandoverPolicy;
  deliveryTarget: 'SCHOOL' | 'HOME' | 'TEMP';
}): boolean {
  if (input.deliveryTarget === 'SCHOOL') return false;
  return input.handoverPolicy === 'GUARDIAN_REQUIRED';
}

export function canGuardianReceiveChild(input: {
  relationActive: boolean;
  canReceiveChild: boolean;
}): boolean {
  return input.relationActive && input.canReceiveChild;
}
