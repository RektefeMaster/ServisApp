import { checkCapacity, type CapacityCheck, type StopOccupancyChange } from './capacity.js';
import { exhaustive } from './exhaustive.js';

export type RouteSegment = 'MORNING' | 'AFTERNOON';
export type StopKind = 'PICKUP' | 'DROPOFF' | 'SCHOOL';

export interface RoutePlanStop {
  stopId: string;
  seq: number;
  kind: StopKind;
  studentIds: readonly string[];
}

export type RoutePlanIssue =
  | { code: 'EMPTY_ROUTE' }
  | { code: 'NEED_PASSENGER_STOP' }
  | { code: 'MISSING_SCHOOL_STOP' }
  | { code: 'MULTIPLE_SCHOOL_STOPS' }
  | { code: 'INVALID_SEQUENCE' }
  | { code: 'DUPLICATE_STOP' }
  | { code: 'WRONG_KIND_FOR_SEGMENT'; kind: StopKind }
  | { code: 'SCHOOL_POSITION'; expected: 'start' | 'end' }
  | { code: 'PASSENGER_STOP_EMPTY'; seq: number }
  | { code: 'STUDENT_ON_SCHOOL_STOP' }
  | { code: 'DUPLICATE_STUDENT'; studentId: string };

export type RoutePlanResult = { ok: true } | { ok: false; issue: RoutePlanIssue };

/**
 * Yayınlanacak taslak rotanın şekil kuralları. Google'a ihtiyaç yok;
 * sefer üretimi bu yapıyı snapshot'lar (SPEC §4, §8).
 *
 * Sabah: evden topla (PICKUP) → okul (SCHOOL, sonda).
 * Akşam: okul (SCHOOL, başta) → evlere bırak (DROPOFF).
 */
export function evaluateRoutePlan(
  segment: RouteSegment,
  stops: readonly RoutePlanStop[],
): RoutePlanResult {
  if (stops.length === 0) return fail({ code: 'EMPTY_ROUTE' });

  const ordered = [...stops].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i]?.seq !== i + 1) return fail({ code: 'INVALID_SEQUENCE' });
  }

  const stopIds = new Set<string>();
  for (const stop of ordered) {
    if (stopIds.has(stop.stopId)) return fail({ code: 'DUPLICATE_STOP' });
    stopIds.add(stop.stopId);
  }

  const schools = ordered.filter((stop) => stop.kind === 'SCHOOL');
  if (schools.length === 0) return fail({ code: 'MISSING_SCHOOL_STOP' });
  if (schools.length > 1) return fail({ code: 'MULTIPLE_SCHOOL_STOPS' });

  const school = schools[0];
  if (!school) return fail({ code: 'MISSING_SCHOOL_STOP' });
  if (school.studentIds.length > 0) return fail({ code: 'STUDENT_ON_SCHOOL_STOP' });

  const passengers = ordered.filter((stop) => stop.kind !== 'SCHOOL');
  if (passengers.length === 0) return fail({ code: 'NEED_PASSENGER_STOP' });

  switch (segment) {
    case 'MORNING':
      if (school.seq !== ordered.length) return fail({ code: 'SCHOOL_POSITION', expected: 'end' });
      break;
    case 'AFTERNOON':
      if (school.seq !== 1) return fail({ code: 'SCHOOL_POSITION', expected: 'start' });
      break;
    default:
      return exhaustive(segment, 'route segment');
  }

  const seenStudents = new Set<string>();
  for (const stop of ordered) {
    switch (stop.kind) {
      case 'SCHOOL':
        break;
      case 'PICKUP':
        if (segment !== 'MORNING') return fail({ code: 'WRONG_KIND_FOR_SEGMENT', kind: stop.kind });
        if (stop.studentIds.length === 0)
          return fail({ code: 'PASSENGER_STOP_EMPTY', seq: stop.seq });
        break;
      case 'DROPOFF':
        if (segment !== 'AFTERNOON')
          return fail({ code: 'WRONG_KIND_FOR_SEGMENT', kind: stop.kind });
        if (stop.studentIds.length === 0)
          return fail({ code: 'PASSENGER_STOP_EMPTY', seq: stop.seq });
        break;
      default:
        return exhaustive(stop.kind, 'stop kind');
    }
    for (const studentId of stop.studentIds) {
      if (seenStudents.has(studentId)) return fail({ code: 'DUPLICATE_STUDENT', studentId });
      seenStudents.add(studentId);
    }
  }

  return { ok: true };
}

export function occupancyForSegment(
  segment: RouteSegment,
  stops: readonly RoutePlanStop[],
): StopOccupancyChange[] {
  const ordered = [...stops].sort((a, b) => a.seq - b.seq);
  const total = ordered
    .filter((stop) => stop.kind !== 'SCHOOL')
    .reduce((sum, stop) => sum + stop.studentIds.length, 0);

  return ordered.map((stop) => {
    switch (stop.kind) {
      case 'PICKUP':
        return { seq: stop.seq, boarding: stop.studentIds.length, alighting: 0 };
      case 'DROPOFF':
        return { seq: stop.seq, boarding: 0, alighting: stop.studentIds.length };
      case 'SCHOOL':
        return segment === 'MORNING'
          ? { seq: stop.seq, boarding: 0, alighting: total }
          : { seq: stop.seq, boarding: total, alighting: 0 };
      default:
        return exhaustive(stop.kind, 'stop kind');
    }
  });
}

export function evaluateRouteCapacity(
  segment: RouteSegment,
  stops: readonly RoutePlanStop[],
  seatCount: number,
): CapacityCheck {
  return checkCapacity(occupancyForSegment(segment, stops), seatCount);
}

function fail(issue: RoutePlanIssue): RoutePlanResult {
  return { ok: false, issue };
}
