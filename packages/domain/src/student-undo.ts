import type { StudentAction } from './student-state-machine.js';
import type { StudentState, TripState } from './states.js';

/** SPEC §6: yalnız 10 dakika içinde, sefer kapandıktan sonra asla. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/** Veli durum bildirimi 60–90 sn gecikir; geri alınırsa hiç gitmez. */
export const GUARDIAN_STATE_HOLD_MS = 75_000;

const UNDOABLE_ACTIONS = ['BOARD', 'MARK_NO_SHOW', 'MARK_DELIVERY_FAILED'] as const satisfies readonly StudentAction[];

export type UndoableStudentAction = (typeof UNDOABLE_ACTIONS)[number];

export type UndoRejectionReason =
  | 'TRIP_NOT_IN_REQUIRED_STATE'
  | 'UNDO_WINDOW_EXPIRED'
  | 'UNDO_NOT_ALLOWED'
  | 'NOT_LAST_ACTION'
  | 'OTP_VERIFICATION_NOT_UNDOABLE'
  | 'STATE_MISMATCH'
  | 'TARGET_NOT_APPLIED';

export function isUndoableStudentAction(action: StudentAction): action is UndoableStudentAction {
  return (UNDOABLE_ACTIONS as readonly string[]).includes(action);
}

export function isUndoableStudentTransition(
  prevState: StudentState,
  newState: StudentState,
): boolean {
  if (newState === 'ON_BOARD') {
    return prevState === 'EXPECTED' || prevState === 'NO_SHOW' || prevState === 'ABSENT_PLANNED';
  }
  if (newState === 'NO_SHOW') return prevState === 'EXPECTED';
  if (newState === 'DELIVERY_FAILED') return prevState === 'ON_BOARD';
  return false;
}

export interface UndoLastEvent {
  eventType: string;
  prevState: string | null;
  newState: string | null;
  sourceCommandId: string | null;
  isUndo: boolean;
  occurredAtMs: number;
}

export function evaluateStudentUndo(input: {
  tripState: TripState;
  currentState: StudentState;
  targetClientEventId: string;
  lastEvent: UndoLastEvent | null;
  nowMs: number;
}): { ok: true; restoreState: StudentState } | { ok: false; reason: UndoRejectionReason } {
  if (input.tripState !== 'ACTIVE') {
    return { ok: false, reason: 'TRIP_NOT_IN_REQUIRED_STATE' };
  }
  if (!input.lastEvent) {
    return { ok: false, reason: 'TARGET_NOT_APPLIED' };
  }
  if (input.lastEvent.eventType === 'DELIVERY_OTP_VERIFIED') {
    return { ok: false, reason: 'OTP_VERIFICATION_NOT_UNDOABLE' };
  }
  if (input.lastEvent.eventType !== 'STUDENT_STATE' || input.lastEvent.isUndo) {
    return { ok: false, reason: 'NOT_LAST_ACTION' };
  }
  if (input.lastEvent.sourceCommandId !== input.targetClientEventId) {
    return { ok: false, reason: 'NOT_LAST_ACTION' };
  }
  if (input.nowMs - input.lastEvent.occurredAtMs > UNDO_WINDOW_MS) {
    return { ok: false, reason: 'UNDO_WINDOW_EXPIRED' };
  }
  const prev = asStudentState(input.lastEvent.prevState);
  const next = asStudentState(input.lastEvent.newState);
  if (!prev || !next) return { ok: false, reason: 'UNDO_NOT_ALLOWED' };
  if (!isUndoableStudentTransition(prev, next)) {
    return { ok: false, reason: 'UNDO_NOT_ALLOWED' };
  }
  if (input.currentState !== next) {
    return { ok: false, reason: 'STATE_MISMATCH' };
  }
  return { ok: true, restoreState: prev };
}

function asStudentState(value: string | null): StudentState | null {
  if (
    value === 'EXPECTED' ||
    value === 'ON_BOARD' ||
    value === 'DELIVERED' ||
    value === 'ABSENT_PLANNED' ||
    value === 'NO_SHOW' ||
    value === 'MOVED_OUT' ||
    value === 'DELIVERY_FAILED' ||
    value === 'DELIVERED_LATE' ||
    value === 'RETURNED_TO_SCHOOL' ||
    value === 'HANDED_TO_ADMIN' ||
    value === 'RETURNED_HOME'
  ) {
    return value;
  }
  return null;
}

export function studentStateNotificationType(state: StudentState): string {
  return `STUDENT_${state}`;
}

export function guardianNotificationHolds(type: string): boolean {
  return type.startsWith('STUDENT_') && type !== 'STUDENT_STATE_CORRECTED';
}
