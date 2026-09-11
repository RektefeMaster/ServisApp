import { z } from 'zod';
import { criticalAlertView } from './exceptions.js';
import { coordinate, instant, phoneE164, serviceDate, uuid } from './primitives.js';
import { stopKind, tripSegment } from './route.js';

export const tripState = z.enum([
  'PLANNED',
  'READY',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'SUSPENDED',
  'ABORTED',
  'AUTO_CLOSED',
]);
export type TripState = z.infer<typeof tripState>;

export const studentState = z.enum([
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
]);
export type StudentState = z.infer<typeof studentState>;

export const vehicleCheckPhase = z.enum(['BEFORE', 'AFTER']);
export type VehicleCheckPhase = z.infer<typeof vehicleCheckPhase>;

export const studentAction = z.enum([
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
]);
export type StudentAction = z.infer<typeof studentAction>;

export const devicePlatform = z.enum(['IOS', 'ANDROID']);

export const generateTripsInput = z.object({
  fromDate: serviceDate.optional(),
  days: z.number().int().min(1).max(14).default(7),
});
export type GenerateTripsInput = z.infer<typeof generateTripsInput>;

export const listTripsQuery = z.object({
  date: serviceDate,
});
export type ListTripsQuery = z.infer<typeof listTripsQuery>;

export const recordVehicleCheckInput = z.object({
  phase: vehicleCheckPhase,
  vehicleEmptyConfirmed: z.literal(true),
});
export type RecordVehicleCheckInput = z.infer<typeof recordVehicleCheckInput>;

export const cancelTripInput = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type CancelTripInput = z.infer<typeof cancelTripInput>;

export const studentCommandInput = z
  .object({
    clientEventId: uuid,
    deviceSeq: z.number().int().nonnegative().optional(),
    tripStudentId: uuid,
    action: studentAction,
    expectedStateSeq: z.number().int().nonnegative(),
    receiverMembershipId: uuid.optional(),
    lat: coordinate.shape.lat.optional(),
    lng: coordinate.shape.lng.optional(),
    occurredAtDevice: instant.optional(),
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: 'lat ve lng birlikte gönderilmeli',
  });
export type StudentCommandInput = z.infer<typeof studentCommandInput>;

export const createHolidayInput = z.object({
  date: serviceDate,
  type: z.literal('HOLIDAY'),
});
export type CreateHolidayInput = z.infer<typeof createHolidayInput>;

export const deliveryTarget = z.enum(['SCHOOL', 'HOME', 'TEMP']);

export const tripSummary = z.object({
  id: uuid,
  routeId: uuid,
  serviceDate,
  segment: tripSegment,
  state: tripState,
  plannedDepartureAt: instant,
  vehicleId: uuid,
  plate: z.string(),
  schoolName: z.string(),
});
export type TripSummary = z.infer<typeof tripSummary>;

export const tripStopView = z.object({
  id: uuid,
  seq: z.number(),
  kind: stopKind,
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
  addressText: z.string(),
  studentIds: z.array(uuid),
});
export type TripStopView = z.infer<typeof tripStopView>;

export const tripStudentView = z.object({
  id: uuid,
  studentId: uuid,
  fullName: z.string(),
  state: studentState,
  stateSeq: z.number().int().nonnegative(),
  deliveryTarget,
  expectedStopId: uuid.nullable(),
  expectedStopLabel: z.string().nullable(),
  needsReview: z.boolean(),
  photoPath: z.string().nullable(),
  guardianPhone: phoneE164.nullable(),
  guardianName: z.string().nullable(),
  deliveryVerified: z.boolean(),
  handoverPolicy: z.enum(['GUARDIAN_REQUIRED', 'MAY_LEAVE_ALONE']),
  receivers: z
    .array(
      z.object({
        membershipId: uuid,
        fullName: z.string(),
        relation: z.string(),
      }),
    )
    .default([]),
  snapshotDropoffText: z.string().nullable(),
  receiverName: z.string().nullable(),
});
export type TripStudentView = z.infer<typeof tripStudentView>;

export const tripLiveLocation = z.object({
  lat: z.number(),
  lng: z.number(),
  heading: z.number().nullable(),
  recordedAt: instant,
  quality: z.enum(['GOOD', 'LOW']),
  isStale: z.boolean(),
});

export const tripDetail = tripSummary.extend({
  routeVersionId: uuid,
  checks: z.object({ before: z.boolean(), after: z.boolean() }),
  stops: z.array(tripStopView),
  students: z.array(tripStudentView),
  locationSessionEpoch: z.number().int().nonnegative(),
  locationSourceDeviceId: uuid.nullable(),
  driverMembershipId: uuid.nullable(),
  attendantMembershipId: uuid.nullable(),
  driverName: z.string().nullable(),
  attendantName: z.string().nullable(),
  seatCount: z.number().int().positive(),
  live: tripLiveLocation.nullable(),
  pendingAlerts: z.array(criticalAlertView).default([]),
});
export type TripDetail = z.infer<typeof tripDetail>;

export const commandResult = z.object({
  replay: z.boolean(),
  status: z.enum(['APPLIED', 'CONFLICT', 'REJECTED', 'PENDING']),
  tripStudentId: uuid,
  state: z.string(),
  stateSeq: z.number().int().nonnegative(),
  reason: z.string().optional(),
});
export type CommandResult = z.infer<typeof commandResult>;

export const undoStudentCommandInput = z
  .object({
    clientEventId: uuid,
    targetClientEventId: uuid,
    tripStudentId: uuid,
    deviceSeq: z.number().int().nonnegative().optional(),
    lat: coordinate.shape.lat.optional(),
    lng: coordinate.shape.lng.optional(),
    occurredAtDevice: instant.optional(),
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: 'lat ve lng birlikte gönderilmeli',
  });
export type UndoStudentCommandInput = z.infer<typeof undoStudentCommandInput>;

export const registerPushTokenInput = z.object({
  deviceId: uuid,
  platform: devicePlatform,
  pushToken: z.string().trim().min(8).max(4096),
  appVersion: z.string().trim().min(1).max(40).optional(),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenInput>;

export const assignTripVehicleInput = z.object({
  vehicleId: uuid,
  reason: z.string().trim().min(3).max(500),
});
export type AssignTripVehicleInput = z.infer<typeof assignTripVehicleInput>;

export const assignTripCrewInput = z.object({
  role: z.enum(['DRIVER', 'ATTENDANT']),
  membershipId: uuid,
  reason: z.string().trim().min(3).max(500),
});
export type AssignTripCrewInput = z.infer<typeof assignTripCrewInput>;

export const createStudentTripMoveInput = z.object({
  studentId: uuid,
  serviceDate,
  segment: tripSegment,
  targetRouteId: uuid,
  reason: z.string().trim().min(3).max(500),
});
export type CreateStudentTripMoveInput = z.infer<typeof createStudentTripMoveInput>;

export const studentTripMoveResult = z.object({
  studentId: uuid,
  serviceDate,
  segment: tripSegment,
  targetRouteId: uuid,
  sourceTripId: uuid.nullable(),
  targetTripId: uuid.nullable(),
  sourceState: studentState.nullable(),
});
export type StudentTripMoveResult = z.infer<typeof studentTripMoveResult>;

export const adminEventView = z.object({
  seq: z.number().int(),
  occurredAt: instant,
  eventType: z.string(),
  subjectType: z.string(),
  subjectId: uuid,
  tripId: uuid.nullable(),
  prevState: z.string().nullable(),
  newState: z.string().nullable(),
  actorRole: z.string().nullable(),
});
export type AdminEventView = z.infer<typeof adminEventView>;

export const adminEventsList = z.object({
  available: z.literal(true),
  items: z.array(adminEventView),
  csv: z.string(),
});
export type AdminEventsList = z.infer<typeof adminEventsList>;

export const adminPriorityKind = z.enum([
  'GPS_STALE',
  'CRITICAL_UNACKED',
  'OTP_LOCKED',
  'OVERRIDE_PENDING',
  'NEEDS_REVIEW',
]);
export type AdminPriorityKind = z.infer<typeof adminPriorityKind>;

export const adminPriorityView = z.object({
  kind: adminPriorityKind,
  severity: z.enum(['WARNING', 'CRITICAL']),
  tripId: uuid.nullable(),
  plate: z.string().nullable(),
  body: z.string(),
});
export type AdminPriorityView = z.infer<typeof adminPriorityView>;

export const adminPrioritiesList = z.object({
  items: z.array(adminPriorityView),
});
export type AdminPrioritiesList = z.infer<typeof adminPrioritiesList>;

export const reportIncidentInput = z.object({
  body: z.string().trim().min(3).max(500),
  studentId: uuid.optional(),
});
export type ReportIncidentInput = z.infer<typeof reportIncidentInput>;

export const tripListResponse = z.object({
  items: z.array(tripSummary),
});
export type TripListResponse = z.infer<typeof tripListResponse>;

export const devLoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(16).max(200),
});
export type DevLoginInput = z.infer<typeof devLoginInput>;
