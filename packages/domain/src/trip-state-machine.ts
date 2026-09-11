import type { ActorRole, StudentState, TripState } from './states.js';
import { blocksCompletion, isOperationalFact, occupiesVehicle } from './states.js';

export type TripRejectionReason =
  | 'ILLEGAL_TRANSITION'
  | 'ROLE_NOT_ALLOWED'
  | 'STUDENTS_STILL_ON_TRIP'
  | 'VEHICLE_SWEEP_NOT_CONFIRMED';

export interface TripTransitionInput {
  from: TripState;
  to: TripState;
  actorRole: ActorRole;
  /** Sefer sonu araç içi kontrolü (mevzuatın zorunlu kıldığı) yapıldı mı. */
  vehicleSweepConfirmed: boolean;
  /** Seferdeki öğrencilerin güncel durumları. */
  studentStates: readonly StudentState[];
}

export type TripTransitionResult = { ok: true } | { ok: false; reason: TripRejectionReason };

const ALLOWED: Readonly<Record<TripState, readonly TripState[]>> = {
  PLANNED: ['READY', 'CANCELLED'],
  READY: ['ACTIVE', 'PLANNED', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'SUSPENDED', 'ABORTED', 'AUTO_CLOSED'],
  SUSPENDED: ['ACTIVE', 'ABORTED'],
  COMPLETED: [],
  CANCELLED: [],
  ABORTED: [],
  AUTO_CLOSED: [],
};

const ACTORS: Readonly<Record<TripState, readonly ActorRole[]>> = {
  READY: ['DRIVER', 'ATTENDANT', 'ADMIN', 'SYSTEM'],
  ACTIVE: ['DRIVER', 'ATTENDANT', 'ADMIN'],
  COMPLETED: ['DRIVER', 'ATTENDANT', 'ADMIN'],
  SUSPENDED: ['DRIVER', 'ATTENDANT', 'ADMIN'],
  ABORTED: ['ADMIN'],
  CANCELLED: ['ADMIN', 'SYSTEM'],
  PLANNED: ['SYSTEM', 'ADMIN'],
  // Şoför bitirmeyi unuttuysa geceleyin sistem kapatır — ama ASLA COMPLETED
  // yazmaz; "kapıya bırakıldı" sayılan sessiz kapanış tam da yasakladığımız şey.
  AUTO_CLOSED: ['SYSTEM'],
};

export function canTransitionTrip(input: TripTransitionInput): TripTransitionResult {
  if (!ALLOWED[input.from].includes(input.to)) return { ok: false, reason: 'ILLEGAL_TRANSITION' };
  if (!ACTORS[input.to].includes(input.actorRole)) return { ok: false, reason: 'ROLE_NOT_ALLOWED' };

  // Ürünün en önemli invariantı: üstünde çocuk varken sefer kapanamaz.
  // COMPLETED/ABORTED çözülmemiş öğrenciyi (EXPECTED dahil) yutamaz.
  // AUTO_CLOSED "teslim edildi" iddiası değildir ama ON_BOARD/DELIVERY_FAILED
  // ile kapanmak araçta unutulan çocuk demektir (SPEC §5, Invariant 2).
  if (input.to === 'COMPLETED' || input.to === 'ABORTED') {
    if (input.studentStates.some(blocksCompletion)) {
      return { ok: false, reason: 'STUDENTS_STILL_ON_TRIP' };
    }
  }
  if (input.to === 'COMPLETED' && !input.vehicleSweepConfirmed) {
    return { ok: false, reason: 'VEHICLE_SWEEP_NOT_CONFIRMED' };
  }
  if (input.to === 'AUTO_CLOSED' && input.studentStates.some(occupiesVehicle)) {
    return { ok: false, reason: 'STUDENTS_STILL_ON_TRIP' };
  }

  // Tatil/kar iptali başlamamış sefer için serbesttir. Ama fiziksel olarak
  // yaşanmış bir sefer "hiç olmamış" gibi iptal edilemez; o bir ABORT'tur ve
  // her öğrenciye açık bir akıbet yazılmasını gerektirir.
  if (input.to === 'CANCELLED' && input.studentStates.some(isOperationalFact)) {
    return { ok: false, reason: 'STUDENTS_STILL_ON_TRIP' };
  }

  return { ok: true };
}
