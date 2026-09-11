import { exhaustive } from './exhaustive.js';
import type { StudentState } from './states.js';
import { isOperationalFact } from './states.js';

/** SPEC §9: 5 yanlış → kilit; tek çıkış yönetici override. */
export const OTP_MAX_ATTEMPTS = 5;
/** Aynı kod yeniden SMS; yeni kod üretilmez. */
export const OTP_MAX_RESENDS = 5;

export const DETOUR_DECISIONS = ['AUTO', 'NEEDS_APPROVAL'] as const;
export type DetourDecision = (typeof DETOUR_DECISIONS)[number];

/** Pin, rotanın `max_detour_m` sınırındaysa otomatik; aşıyorsa yönetici onayı. */
export function detourDecision(distanceM: number, maxDetourM: number): DetourDecision {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 'NEEDS_APPROVAL';
  if (!Number.isFinite(maxDetourM) || maxDetourM < 0) return 'NEEDS_APPROVAL';
  return distanceM <= maxDetourM ? 'AUTO' : 'NEEDS_APPROVAL';
}

export function otpLockedAfterAttempts(attemptCount: number): boolean {
  return attemptCount >= OTP_MAX_ATTEMPTS;
}

export function canResendOtp(resendCount: number): boolean {
  return resendCount < OTP_MAX_RESENDS;
}

/**
 * ACTIVE seferde durak geçildiyse uyarı düşer (SPEC §7: uyarı durak bazlıdır).
 * `arrivedAt` doluysa araç o durağa vardı.
 */
export function criticalAlertAutoDropped(input: {
  tripState: 'PLANNED' | 'READY' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'SUSPENDED' | 'ABORTED' | 'AUTO_CLOSED';
  stopArrivedAt: Date | null;
}): boolean {
  switch (input.tripState) {
    case 'COMPLETED':
    case 'CANCELLED':
    case 'ABORTED':
    case 'AUTO_CLOSED':
      return true;
    case 'PLANNED':
    case 'READY':
    case 'SUSPENDED':
      return false;
    case 'ACTIVE':
      return input.stopArrivedAt !== null;
    default:
      return exhaustive(input.tripState, 'criticalAlertAutoDropped');
  }
}

/** Veli "bugün binmeyecek"i geri alınca yalnız planlı yokluk beklenene döner. */
export function reconcileCancelRideException(currentState: StudentState): {
  kind: 'APPLY';
  nextState: 'EXPECTED';
} | { kind: 'IGNORE'; reason: 'OPERATIONAL_FACT_WINS' } {
  if (currentState === 'ABSENT_PLANNED') return { kind: 'APPLY', nextState: 'EXPECTED' };
  if (isOperationalFact(currentState) || currentState === 'NO_SHOW' || currentState === 'MOVED_OUT') {
    return { kind: 'IGNORE', reason: 'OPERATIONAL_FACT_WINS' };
  }
  return { kind: 'IGNORE', reason: 'OPERATIONAL_FACT_WINS' };
}
