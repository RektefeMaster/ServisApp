import { exhaustive } from './exhaustive.js';
import type { StopKind } from './route-plan.js';
import { applyStudentAction, type StudentAction } from './student-state-machine.js';
import {
  blocksCompletion,
  isOperationalFact,
  occupiesVehicle,
  type ActorRole,
  type DeliveryTarget,
  type StudentState,
  type TripState,
} from './states.js';

export type CrewSegment = 'MORNING' | 'AFTERNOON';

export interface CrewStop {
  id: string;
  seq: number;
  kind: StopKind;
  label: string;
  lat: number;
  lng: number;
  addressText: string;
  studentIds: string[];
}

export interface CrewStudent {
  id: string;
  studentId: string;
  fullName: string;
  state: StudentState;
  stateSeq: number;
  deliveryTarget: DeliveryTarget;
  deliveryVerified: boolean;
  handoverPolicy?: 'GUARDIAN_REQUIRED' | 'MAY_LEAVE_ALONE';
  expectedStopId: string | null;
  needsReview: boolean;
}

export interface CrewTripView {
  segment: CrewSegment;
  state: TripState;
  checks: { before: boolean; after: boolean };
  stops: readonly CrewStop[];
  students: readonly CrewStudent[];
}

export interface TripFocus {
  currentStop: CrewStop | null;
  nextStudent: CrewStudent | null;
  pendingAtStop: CrewStudent[];
  destinationLabel: string;
  remainingOnBoard: number;
  remainingExpected: number;
}

export type TripGate =
  | { kind: 'VEHICLE_CHECK'; phase: 'BEFORE' | 'AFTER' }
  | { kind: 'START' }
  | { kind: 'COMPLETE' }
  | { kind: 'OPERATE' }
  | { kind: 'DONE' };

/**
 * Seferi kapatmayı engelleyen öğrenciler ve sebepleri.
 *
 * `tripGate` yalnız "OPERATE" diyordu; "Teslim edilemedi" durumundaki çocuk ise
 * hiçbir durakta işaretlenebilir olmadığı için ekranda görünmüyordu. Şoför
 * "Bu durakta işaretlenecek öğrenci kalmadı" yazısıyla kilitli bir seferde
 * kalıyor, neyin engellediğini asla öğrenemiyordu.
 */
export interface CompletionBlocker {
  id: string;
  fullName: string;
  state: StudentState;
  /** Şoförün kendi çözebileceği bir durum mu, yoksa yönetici mi gerekiyor. */
  needsAdmin: boolean;
}

export function completionBlockers(trip: CrewTripView): CompletionBlocker[] {
  return trip.students
    .filter((student) => blocksCompletion(student.state))
    .map((student) => ({
      id: student.id,
      fullName: student.fullName,
      state: student.state,
      needsAdmin: student.state === 'DELIVERY_FAILED',
    }));
}

export function tripGate(trip: CrewTripView): TripGate {
  switch (trip.state) {
    case 'PLANNED':
      return trip.checks.before ? { kind: 'START' } : { kind: 'VEHICLE_CHECK', phase: 'BEFORE' };
    case 'READY':
      return { kind: 'START' };
    case 'ACTIVE': {
      if (trip.students.some((student) => blocksCompletion(student.state))) {
        return { kind: 'OPERATE' };
      }
      if (!trip.checks.after) return { kind: 'VEHICLE_CHECK', phase: 'AFTER' };
      return { kind: 'COMPLETE' };
    }
    case 'SUSPENDED':
      return { kind: 'OPERATE' };
    case 'COMPLETED':
    case 'CANCELLED':
    case 'ABORTED':
    case 'AUTO_CLOSED':
      return { kind: 'DONE' };
    default: {
      const unexpected: never = trip.state;
      return exhaustive(unexpected, 'tripGate');
    }
  }
}

export function tripFocus(trip: CrewTripView): TripFocus {
  const ordered = [...trip.stops].sort((left, right) => left.seq - right.seq);
  let currentStop: CrewStop | null = null;
  let pendingAtStop: CrewStudent[] = [];
  for (const stop of ordered) {
    const pending = pendingStudentsAtStop(trip, stop);
    if (pending.length > 0) {
      currentStop = stop;
      pendingAtStop = pending;
      break;
    }
  }
  return {
    currentStop,
    nextStudent: pendingAtStop[0] ?? null,
    pendingAtStop,
    destinationLabel: currentStop?.label ?? 'Rota bitti',
    remainingOnBoard: trip.students.filter((student) => occupiesVehicle(student.state)).length,
    remainingExpected: trip.students.filter((student) => student.state === 'EXPECTED').length,
  };
}

export function pendingStudentsAtStop(trip: CrewTripView, stop: CrewStop): CrewStudent[] {
  const pending = trip.students.filter((student) => studentWorksAtStop(trip, stop, student));
  const order = new Map(stop.studentIds.map((id, index) => [id, index]));
  return [...pending].sort((left, right) => {
    const leftRank = order.get(left.studentId) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = order.get(right.studentId) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

/**
 * Bu kapının sayacı: kaç öğrenci işlendi / bu kapıda kaç öğrenci var.
 *
 * Ekran bu sayıyı durak ÜYELİĞİNDEN türetiyordu (`expectedStopId` ya da
 * `stop.studentIds`). Akşam seferinde öğrenciler kendi İNİŞ duraklarına
 * bağlıdır; okul kapısında hiçbirinin üyeliği yoktur. Sonuç: şoför okulda iki
 * çocuğu bindirirken ekran "Bu kapıda 0/0" yazıyordu ve her binişte de 0/0
 * kalıyordu — günün en kalabalık kapısında ilerleme geri bildirimi YOKTU.
 *
 * Doğru küme, kapının gerçekten işlediği öğrencilerdir: bekleyenler + işlemi
 * burada bitmiş olanlar. Bugün binmeyecek çocuk hiçbir kapıda sayılmaz.
 */
export function stopWorkload(trip: CrewTripView, stop: CrewStop): { done: number; total: number } {
  const cohort = trip.students.filter((student) => {
    if (skipsTrip(student.state)) return false;
    return studentWorksAtStop(trip, stop, student) || studentSettledAtStop(trip, stop, student);
  });
  const pending = cohort.filter((student) => studentWorksAtStop(trip, stop, student)).length;
  return { done: cohort.length - pending, total: cohort.length };
}

export function crewActionsForStudent(
  student: CrewStudent,
  tripState: TripState,
  actorRole: ActorRole,
  receiverMembershipId?: string | null,
): StudentAction[] {
  const candidates: StudentAction[] = [
    'BOARD',
    'MARK_NO_SHOW',
    'DELIVER',
    'MARK_DELIVERY_FAILED',
    'RETURN_HOME',
  ];
  return candidates.filter(
    (action) =>
      applyStudentAction({
        action,
        currentState: student.state,
        tripState,
        actorRole,
        deliveryTarget: student.deliveryTarget,
        deliveryVerified: student.deliveryVerified,
        handoverPolicy: student.handoverPolicy,
        receiverMembershipId,
      }).ok,
  );
}

export function resumeOpenTrip(
  trips: ReadonlyArray<{ id: string; state: TripState }>,
  lastTripId: string | null,
): { id: string; reason: 'ACTIVE' | 'LAST_OPEN' } | null {
  const active = trips.find((trip) => trip.state === 'ACTIVE');
  if (active) return { id: active.id, reason: 'ACTIVE' };
  if (!lastTripId) return null;
  const last = trips.find(
    (trip) => trip.id === lastTripId && (trip.state === 'PLANNED' || trip.state === 'READY'),
  );
  return last ? { id: last.id, reason: 'LAST_OPEN' } : null;
}

/** Bugün hiç binmeyecek: hiçbir kapıda işlem beklemiyor, sayaca da girmez. */
function skipsTrip(state: StudentState): boolean {
  return state === 'ABSENT_PLANNED' || state === 'MOVED_OUT';
}

/** Bu kapının işi bu öğrenci için BİTTİ mi (bekleyenlerin tersi). */
function studentSettledAtStop(trip: CrewTripView, stop: CrewStop, student: CrewStudent): boolean {
  const atStop = student.expectedStopId === stop.id || stop.studentIds.includes(student.studentId);
  switch (stop.kind) {
    // Kapıda işlem gördü: bindi ya da "durakta yoktu" işaretlendi.
    case 'PICKUP':
      return atStop && student.state !== 'EXPECTED';
    // İniş kapısı yalnız araca binmiş çocuğu işler; hiç binmemiş çocuk bu
    // kapının işi değildir (sefer sonu engelleri onu ayrıca gösterir).
    case 'DROPOFF':
      return atStop && isOperationalFact(student.state) && student.state !== 'ON_BOARD';
    case 'SCHOOL':
      switch (trip.segment) {
        // Sabah okulda yalnız araca binmiş olanlar iner; durakta yok yazılan
        // çocuk bu kapıdan hiç geçmez.
        case 'MORNING':
          return isOperationalFact(student.state) && student.state !== 'ON_BOARD';
        // Akşam okul kapısı bütün listeyi işler: herkes burada biner.
        case 'AFTERNOON':
          return student.state !== 'EXPECTED';
        default: {
          const unexpected: never = trip.segment;
          return exhaustive(unexpected, 'studentSettledAtStop.segment');
        }
      }
    default: {
      const unexpected: never = stop.kind;
      return exhaustive(unexpected, 'studentSettledAtStop');
    }
  }
}

function studentWorksAtStop(trip: CrewTripView, stop: CrewStop, student: CrewStudent): boolean {
  const atStop = student.expectedStopId === stop.id || stop.studentIds.includes(student.studentId);
  switch (stop.kind) {
    case 'PICKUP':
      return atStop && student.state === 'EXPECTED';
    case 'DROPOFF':
      return atStop && student.state === 'ON_BOARD';
    case 'SCHOOL':
      switch (trip.segment) {
        case 'MORNING':
          if (student.state === 'ON_BOARD') return true;
          return (
            student.state === 'EXPECTED' &&
            (student.expectedStopId === stop.id || stop.studentIds.includes(student.studentId))
          );
        case 'AFTERNOON':
          return student.state === 'EXPECTED';
        default: {
          const unexpected: never = trip.segment;
          return exhaustive(unexpected, 'studentWorksAtStop.segment');
        }
      }
    default: {
      const unexpected: never = stop.kind;
      return exhaustive(unexpected, 'studentWorksAtStop');
    }
  }
}
