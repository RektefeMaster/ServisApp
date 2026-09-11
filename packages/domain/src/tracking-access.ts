import type { StudentState, TripState } from './states.js';

/** Kanal / polling: öğrenci seferde henüz tamamlanmamış. */
export const TRACKING_OPEN_STUDENT_STATES = [
  'EXPECTED',
  'ON_BOARD',
  'DELIVERY_FAILED',
] as const satisfies readonly StudentState[];

export function studentStillTracked(state: StudentState): boolean {
  return (TRACKING_OPEN_STUDENT_STATES as readonly StudentState[]).includes(state);
}

export function tripBroadcastOpen(state: TripState): boolean {
  return state === 'ACTIVE';
}

export function parentCanTrack(input: {
  membershipStatus: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED';
  guardianRelationActive: boolean;
  tripState: TripState;
  studentState: StudentState;
}): boolean {
  if (input.membershipStatus !== 'ACTIVE') return false;
  if (!input.guardianRelationActive) return false;
  if (!tripBroadcastOpen(input.tripState)) return false;
  return studentStillTracked(input.studentState);
}

export interface SharedVehicleBroadcast {
  vehicleLat: number;
  vehicleLng: number;
  heading: number | null;
  recordedAt: string;
  quality: 'GOOD' | 'LOW';
}

export function sharedTrackingPayload(input: SharedVehicleBroadcast): SharedVehicleBroadcast {
  return {
    vehicleLat: input.vehicleLat,
    vehicleLng: input.vehicleLng,
    heading: input.heading,
    recordedAt: input.recordedAt,
    quality: input.quality,
  };
}
