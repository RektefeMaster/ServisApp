/**
 * Sefer ve öğrenci durumları (SPEC §5).
 *
 * Sabah/akşam için AYRI durum makinesi yok. İkisi de aynı makineyi kullanır;
 * fark `deliveryTarget` alanındadır. İki paralel enum tutmak her guard'ı, her
 * ekran metnini ve offline reducer'ı iki kez yazdırır ve zamanla ayrışırlar.
 */

export const TRIP_STATES = [
  'PLANNED',
  'READY',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'SUSPENDED',
  'ABORTED',
  'AUTO_CLOSED',
] as const;
export type TripState = (typeof TRIP_STATES)[number];

export const STUDENT_STATES = [
  'EXPECTED',
  'ON_BOARD',
  'DELIVERED',
  'ABSENT_PLANNED',
  'NO_SHOW',
  'MOVED_OUT',
  'DELIVERY_FAILED',
  'DELIVERED_LATE',
  'RETURNED_TO_SCHOOL',
  'HANDED_TO_ADMIN',
  'RETURNED_HOME',
] as const;
export type StudentState = (typeof STUDENT_STATES)[number];

/** SCHOOL = sabah teslimi · HOME = kodsuz akşam teslimi · TEMP = kod ZORUNLU */
export const DELIVERY_TARGETS = ['SCHOOL', 'HOME', 'TEMP'] as const;
export type DeliveryTarget = (typeof DELIVERY_TARGETS)[number];

export const ACTOR_ROLES = ['ADMIN', 'DRIVER', 'ATTENDANT', 'GUARDIAN', 'SYSTEM'] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

/**
 * Sefer bu durumlardan biri varken KAPATILAMAZ. Bu listenin tek bir üyesini
 * kaybetmek "araçta unutulan çocuk" demektir — DB'de de aynısı zorlanır.
 */
export const STATES_BLOCKING_COMPLETION = [
  'EXPECTED',
  'ON_BOARD',
  'DELIVERY_FAILED',
] as const satisfies readonly StudentState[];

/**
 * Fiziksel gerçeklik oluşmuş durumlar. reconcile bunları ASLA yeniden yazamaz;
 * çocuk araçtaysa gelen bir "bugün binmeyecek" bildirimi planı değil, teslim
 * akışını ilgilendirir (SPEC §7).
 */
export const OPERATIONAL_FACT_STATES = [
  'ON_BOARD',
  'DELIVERED',
  'DELIVERY_FAILED',
  'DELIVERED_LATE',
  'RETURNED_TO_SCHOOL',
  'HANDED_TO_ADMIN',
  'RETURNED_HOME',
] as const satisfies readonly StudentState[];

/**
 * Sefer sonu "araç boş" kontrolü bunlardan biri varken yalan olur.
 * EXPECTED çocuğu araçta değildir; ON_BOARD / DELIVERY_FAILED çocuğu vardır.
 */
export const STATES_OCCUPYING_VEHICLE = [
  'ON_BOARD',
  'DELIVERY_FAILED',
] as const satisfies readonly StudentState[];

export function blocksCompletion(state: StudentState): boolean {
  return (STATES_BLOCKING_COMPLETION as readonly StudentState[]).includes(state);
}

export function occupiesVehicle(state: StudentState): boolean {
  return (STATES_OCCUPYING_VEHICLE as readonly StudentState[]).includes(state);
}

export function isOperationalFact(state: StudentState): boolean {
  return (OPERATIONAL_FACT_STATES as readonly StudentState[]).includes(state);
}
