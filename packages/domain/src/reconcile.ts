import { exhaustive } from './exhaustive.js';
import { isOperationalFact, type DeliveryTarget, type StudentState } from './states.js';

/**
 * İstisnalar mutasyon değil GİRDİdir (SPEC §7). reconcile yalnız PLAN katmanını
 * üretir; fiziksel gerçeklik oluşmuş durumları asla yeniden yazamaz.
 *
 * Bu tablo olmadan kural uygulama kodunda saçaklanır: "çocuk araçtayken veli
 * iptal ederse ne olur" sorusunun tek bir yerde cevabı olmalı.
 */
export const EXCEPTION_INPUTS = [
  'RIDE_EXCEPTION',
  'STUDENT_TRIP_MOVE',
  'DELIVERY_OVERRIDE',
] as const;
export type ExceptionInput = (typeof EXCEPTION_INPUTS)[number];

export type ReconcileOutcome =
  /** Plan güncellenir; sefer ACTIVE ise personele kritik değişiklik uyarısı çıkar. */
  | { kind: 'APPLY'; nextState: StudentState }
  /** State değişmez; teslim hedefi TEMP olur. */
  | { kind: 'APPLY_TARGET'; deliveryTarget: Extract<DeliveryTarget, 'TEMP'> }
  /** Operasyon gerçeği korunur, yalnız bilgi olayı yazılır. */
  | { kind: 'IGNORE'; reason: 'OPERATIONAL_FACT_WINS' }
  /** İnsan bakmalı: durum çelişkili ama otomatik karar vermek tehlikeli. */
  | { kind: 'FLAG_FOR_REVIEW'; reason: 'CONTRADICTS_FIELD_OBSERVATION' }
  /** Talep reddedilir ve başka bir akışa yönlendirilir. */
  | { kind: 'REJECT'; redirectTo: 'DELIVERY_CHANGE_REQUEST' | 'ADMIN_DECISION' };

export function reconcileStudent(
  currentState: StudentState,
  input: ExceptionInput,
): ReconcileOutcome {
  switch (input) {
    case 'DELIVERY_OVERRIDE':
      if (currentState === 'ON_BOARD') {
        return { kind: 'REJECT', redirectTo: 'DELIVERY_CHANGE_REQUEST' };
      }
      if (isOperationalFact(currentState) || currentState === 'MOVED_OUT') {
        return { kind: 'IGNORE', reason: 'OPERATIONAL_FACT_WINS' };
      }
      if (currentState === 'NO_SHOW') {
        return { kind: 'FLAG_FOR_REVIEW', reason: 'CONTRADICTS_FIELD_OBSERVATION' };
      }
      return { kind: 'APPLY_TARGET', deliveryTarget: 'TEMP' };
    case 'RIDE_EXCEPTION':
    case 'STUDENT_TRIP_MOVE':
      return reconcilePresence(currentState, input);
    default:
      return exhaustive(input, 'reconcileStudent');
  }
}

function reconcilePresence(
  currentState: StudentState,
  input: Extract<ExceptionInput, 'RIDE_EXCEPTION' | 'STUDENT_TRIP_MOVE'>,
): ReconcileOutcome {
  // Çocuk fiziksel olarak araçtaysa "bugün binmeyecek" anlamsızdır; bu artık
  // bir teslim/hedef değişikliği talebidir.
  if (currentState === 'ON_BOARD') {
    return {
      kind: 'REJECT',
      redirectTo: input === 'RIDE_EXCEPTION' ? 'DELIVERY_CHANGE_REQUEST' : 'ADMIN_DECISION',
    };
  }

  if (isOperationalFact(currentState)) return { kind: 'IGNORE', reason: 'OPERATIONAL_FACT_WINS' };

  // Personel kapıda "yok" dedi, ardından veli "gelmeyecek" bildirdi: çelişki
  // değil ama sıralama şüpheli — sessizce ezmek yerine işaretliyoruz.
  if (currentState === 'NO_SHOW') {
    return { kind: 'FLAG_FOR_REVIEW', reason: 'CONTRADICTS_FIELD_OBSERVATION' };
  }

  if (currentState === 'MOVED_OUT') return { kind: 'IGNORE', reason: 'OPERATIONAL_FACT_WINS' };

  const nextState: StudentState = input === 'RIDE_EXCEPTION' ? 'ABSENT_PLANNED' : 'MOVED_OUT';
  if (currentState === nextState) return { kind: 'IGNORE', reason: 'OPERATIONAL_FACT_WINS' };

  return { kind: 'APPLY', nextState };
}
