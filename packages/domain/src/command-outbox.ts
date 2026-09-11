import { applyStudentAction, type StudentAction } from './student-state-machine.js';
import { exhaustive } from './exhaustive.js';
import type { CrewStudent } from './crew-focus.js';
import { STUDENT_STATES, type ActorRole, type StudentState, type TripState } from './states.js';

export type OutboxStatus = 'PENDING' | 'IN_FLIGHT' | 'CONFLICT' | 'REJECTED' | 'APPLIED';

export interface OutboxItem {
  clientEventId: string;
  tripId: string;
  tripStudentId: string;
  action: StudentAction;
  expectedStateSeq: number;
  deviceSeq: number;
  occurredAtDevice: string;
  status: OutboxStatus;
  conflictState?: StudentState;
  conflictStateSeq?: number;
  rejectReason?: string;
}

export interface CommandServerResult {
  replay: boolean;
  status: 'APPLIED' | 'CONFLICT' | 'REJECTED';
  tripStudentId: string;
  state: string;
  stateSeq: number;
  reason?: string;
}

export function nextDeviceSeq(items: readonly OutboxItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.deviceSeq), -1) + 1;
}

export function nextFlushBatch(items: readonly OutboxItem[]): OutboxItem[] {
  const blocked = new Set(
    items
      .filter(
        (item) =>
          item.status === 'CONFLICT' || item.status === 'IN_FLIGHT' || item.status === 'REJECTED',
      )
      .map((item) => item.tripStudentId),
  );
  return [...items]
    .filter((item) => item.status === 'PENDING' && !blocked.has(item.tripStudentId))
    .sort((left, right) => left.deviceSeq - right.deviceSeq);
}

/** Uygulama uçuş sırasında ölürse IN_FLIGHT komut sonsuza dek kuyruğu kilitler. */
export function recoverInFlight(items: readonly OutboxItem[]): OutboxItem[] {
  return items.map((item) =>
    item.status === 'IN_FLIGHT' ? { ...item, status: 'PENDING' as const } : item,
  );
}

export function asStudentState(value: string): StudentState | undefined {
  return (STUDENT_STATES as readonly string[]).includes(value)
    ? (value as StudentState)
    : undefined;
}

export function applyOptimistic(
  student: CrewStudent,
  action: StudentAction,
  tripState: TripState,
  actorRole: ActorRole,
): { ok: true; student: CrewStudent } | { ok: false; reason: string } {
  const result = applyStudentAction({
    action,
    currentState: student.state,
    tripState,
    actorRole,
    deliveryTarget: student.deliveryTarget,
    deliveryVerified: student.deliveryVerified,
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    student: {
      ...student,
      state: result.nextState,
      stateSeq: student.stateSeq + 1,
    },
  };
}

export function applyServerResult(item: OutboxItem, result: CommandServerResult): OutboxItem {
  if (result.tripStudentId !== item.tripStudentId) {
    return { ...item, status: 'REJECTED', rejectReason: 'TRIP_STUDENT_MISMATCH' };
  }
  switch (result.status) {
    case 'APPLIED':
      return { ...item, status: 'APPLIED' };
    case 'CONFLICT':
      return {
        ...item,
        status: 'CONFLICT',
        conflictState: asStudentState(result.state),
        conflictStateSeq: result.stateSeq,
      };
    case 'REJECTED':
      return {
        ...item,
        status: 'REJECTED',
        rejectReason: result.reason,
        conflictState: asStudentState(result.state),
        conflictStateSeq: result.stateSeq,
      };
    default: {
      const unexpected: never = result.status;
      return exhaustive(unexpected, 'applyServerResult');
    }
  }
}

export function reconcileStudentFromServer(
  student: CrewStudent,
  result: Pick<CommandServerResult, 'state' | 'stateSeq'>,
  needsReview: boolean,
): CrewStudent {
  return {
    ...student,
    state: asStudentState(result.state) ?? student.state,
    stateSeq: result.stateSeq,
    needsReview,
  };
}

export function dropPendingForStudent(
  items: readonly OutboxItem[],
  tripStudentId: string,
): OutboxItem[] {
  return items.filter(
    (item) => item.tripStudentId !== tripStudentId || item.status !== 'PENDING',
  );
}
