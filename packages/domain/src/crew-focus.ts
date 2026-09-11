import { exhaustive } from './exhaustive.js';
import type { StopKind } from './route-plan.js';
import { applyStudentAction, type StudentAction } from './student-state-machine.js';
import {
  blocksCompletion,
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
  return [...pending].sort((left, right) => left.fullName.localeCompare(right.fullName, 'tr'));
}

export function crewActionsForStudent(
  student: CrewStudent,
  tripState: TripState,
  actorRole: ActorRole,
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

function studentWorksAtStop(trip: CrewTripView, stop: CrewStop, student: CrewStudent): boolean {
  const atStop =
    student.expectedStopId === stop.id || stop.studentIds.includes(student.studentId);
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
