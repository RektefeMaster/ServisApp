import type { ActorRole, DeliveryTarget, StudentState, TripState } from './states.js';

/**
 * İstemci DURUM göndermez, NİYET gönderir. Sunucu sonucu kendisi hesaplar
 * (SPEC §3). Bu yüzden geçişler "aksiyon" üzerinden tanımlanır.
 */
export const STUDENT_ACTIONS = [
  'BOARD',
  'MARK_NO_SHOW',
  'DELIVER',
  'MARK_DELIVERY_FAILED',
  'RETURN_HOME',
  'RESOLVE_DELIVERED_LATE',
  'RESOLVE_RETURNED_TO_SCHOOL',
  'RESOLVE_HANDED_TO_ADMIN',
  'MARK_ABSENT_PLANNED',
  'MOVE_OUT',
] as const;
export type StudentAction = (typeof STUDENT_ACTIONS)[number];

export type RejectionReason =
  | 'ILLEGAL_TRANSITION'
  | 'ROLE_NOT_ALLOWED'
  | 'TRIP_NOT_IN_REQUIRED_STATE'
  | 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE'
  | 'GUARDIAN_RECEIVER_REQUIRED'
  | 'ALREADY_IN_TARGET_STATE';

export type HandoverPolicy = 'GUARDIAN_REQUIRED' | 'MAY_LEAVE_ALONE';

export interface StudentTransitionInput {
  action: StudentAction;
  currentState: StudentState;
  tripState: TripState;
  actorRole: ActorRole;
  deliveryTarget: DeliveryTarget;
  /** Farklı adrese teslimde sunucu tarafı doğrulama yapıldı mı (OTP veya admin override). */
  deliveryVerified: boolean;
  handoverPolicy?: HandoverPolicy;
  /** GUARDIAN_REQUIRED ev/temp tesliminde ACTIVE+canReceiveChild alıcı. */
  receiverMembershipId?: string | null;
}

export type TransitionResult =
  { ok: true; nextState: StudentState } | { ok: false; reason: RejectionReason };

const CREW = ['DRIVER', 'ATTENDANT', 'ADMIN'] as const satisfies readonly ActorRole[];

interface Rule {
  from: readonly StudentState[];
  to: StudentState;
  actors: readonly ActorRole[];
  tripStates: readonly TripState[];
  guard?: (input: StudentTransitionInput) => RejectionReason | null;
}

const RULES: Readonly<Record<StudentAction, Rule>> = {
  // Planlı devamsız veya kapıda bulunamamış çocuk sonradan yetişebilir; bunu
  // "geri alma" ile taklit ettirmiyoruz, gerçek bir geçiş olarak tanıyoruz.
  BOARD: {
    from: ['EXPECTED', 'NO_SHOW', 'ABSENT_PLANNED'],
    to: 'ON_BOARD',
    actors: CREW,
    tripStates: ['ACTIVE'],
  },
  MARK_NO_SHOW: {
    from: ['EXPECTED'],
    to: 'NO_SHOW',
    actors: CREW,
    tripStates: ['ACTIVE'],
  },
  DELIVER: {
    from: ['ON_BOARD'],
    to: 'DELIVERED',
    actors: CREW,
    tripStates: ['ACTIVE'],
    // Kırmızı çizgi: kayıtlı adrese kod yok, farklı adrese kod ZORUNLU.
    // GUARDIAN_REQUIRED: kapıda yetkili alıcı üyeliği zorunlu.
    guard: (input) => deliveryGuard(input),
  },
  MARK_DELIVERY_FAILED: {
    from: ['ON_BOARD', 'DELIVERY_FAILED'],
    to: 'DELIVERY_FAILED',
    actors: CREW,
    tripStates: ['ACTIVE', 'SUSPENDED'],
  },
  RETURN_HOME: {
    from: ['ON_BOARD'],
    to: 'RETURNED_HOME',
    actors: CREW,
    tripStates: ['ACTIVE', 'SUSPENDED'],
    guard: (input) => {
      if (input.deliveryTarget === 'SCHOOL') return 'ILLEGAL_TRANSITION';
      return deliveryGuard(input);
    },
  },
  // Teslim edilemeyen çocuğun akıbetine uygulama karar vermez; yönetici verir.
  RESOLVE_DELIVERED_LATE: {
    from: ['DELIVERY_FAILED'],
    to: 'DELIVERED_LATE',
    actors: ['ADMIN'],
    tripStates: ['ACTIVE', 'SUSPENDED', 'ABORTED'],
    guard: (input) => deliveryGuard(input),
  },
  RESOLVE_RETURNED_TO_SCHOOL: {
    from: ['DELIVERY_FAILED'],
    to: 'RETURNED_TO_SCHOOL',
    actors: ['ADMIN'],
    tripStates: ['ACTIVE', 'SUSPENDED', 'ABORTED'],
  },
  RESOLVE_HANDED_TO_ADMIN: {
    from: ['DELIVERY_FAILED'],
    to: 'HANDED_TO_ADMIN',
    actors: ['ADMIN'],
    tripStates: ['ACTIVE', 'SUSPENDED', 'ABORTED'],
  },
  // Bu ikisi personel eylemi değil; istisna girdisinin projeksiyonudur (§7).
  MARK_ABSENT_PLANNED: {
    from: ['EXPECTED'],
    to: 'ABSENT_PLANNED',
    actors: ['SYSTEM', 'ADMIN'],
    tripStates: ['PLANNED', 'READY', 'ACTIVE'],
  },
  MOVE_OUT: {
    from: ['EXPECTED', 'ABSENT_PLANNED'],
    to: 'MOVED_OUT',
    actors: ['SYSTEM', 'ADMIN'],
    tripStates: ['PLANNED', 'READY', 'ACTIVE'],
  },
};

export function applyStudentAction(input: StudentTransitionInput): TransitionResult {
  const rule = RULES[input.action];

  if (!rule.actors.includes(input.actorRole)) return { ok: false, reason: 'ROLE_NOT_ALLOWED' };
  if (!rule.tripStates.includes(input.tripState)) {
    return { ok: false, reason: 'TRIP_NOT_IN_REQUIRED_STATE' };
  }
  if (!rule.from.includes(input.currentState)) {
    return {
      ok: false,
      reason: input.currentState === rule.to ? 'ALREADY_IN_TARGET_STATE' : 'ILLEGAL_TRANSITION',
    };
  }

  const guardFailure = rule.guard?.(input) ?? null;
  if (guardFailure) return { ok: false, reason: guardFailure };

  return { ok: true, nextState: rule.to };
}

export function studentActionTargetState(action: StudentAction): StudentState {
  return RULES[action].to;
}

function deliveryGuard(input: StudentTransitionInput): RejectionReason | null {
  if (input.deliveryTarget === 'TEMP' && !input.deliveryVerified) {
    return 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE';
  }
  if (input.deliveryTarget === 'SCHOOL') return null;
  // Fail-closed: policy yoksa GUARDIAN_REQUIRED (onboarding/SQL default ile aynı).
  const policy = input.handoverPolicy ?? 'GUARDIAN_REQUIRED';
  if (policy === 'GUARDIAN_REQUIRED') {
    const receiver = input.receiverMembershipId?.trim() ?? '';
    if (receiver.length === 0) return 'GUARDIAN_RECEIVER_REQUIRED';
  }
  return null;
}
