import { z } from 'zod';
import { coordinate, instant, phoneE164, uuid } from './primitives.js';
import { parentDayPlan } from './exceptions.js';
import { studentPlanStatus } from './onboarding.js';
import { tripSegment } from './route.js';
import { studentState, tripState } from './trip.js';

export const locationQuality = z.enum(['GOOD', 'LOW', 'REJECTED']);
export type LocationQuality = z.infer<typeof locationQuality>;

export const locationPingInput = z.object({
  lat: coordinate.shape.lat,
  lng: coordinate.shape.lng,
  accuracyM: z.number().min(0).max(10_000).nullable().optional(),
  speedMps: z.number().min(0).max(80).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  recordedAt: instant,
  sessionEpoch: z.number().int().nonnegative(),
});
export type LocationPingInput = z.infer<typeof locationPingInput>;

export const locationIngestResult = z.object({
  accepted: z.boolean(),
  quality: locationQuality,
  reason: z.string().optional(),
  liveAvailable: z.boolean(),
  sessionEpoch: z.number().int().nonnegative(),
  locationSourceDeviceId: uuid.nullable(),
  trackingEnded: z.boolean(),
});
export type LocationIngestResult = z.infer<typeof locationIngestResult>;

export const vehicleBroadcast = z.object({
  vehicleLat: coordinate.shape.lat,
  vehicleLng: coordinate.shape.lng,
  heading: z.number().min(0).max(360).nullable(),
  recordedAt: instant,
  quality: z.enum(['GOOD', 'LOW']),
});
export type VehicleBroadcast = z.infer<typeof vehicleBroadcast>;

export const parentOwnStop = z.object({
  lat: coordinate.shape.lat,
  lng: coordinate.shape.lng,
  label: z.string(),
});

export const parentLiveTrip = z.object({
  tripId: uuid,
  studentId: uuid,
  segment: tripSegment,
  tripState: tripState,
  studentState: studentState,
  vehicle: vehicleBroadcast.nullable(),
  liveAvailable: z.boolean(),
  staleMessage: z.string().nullable(),
  ownStop: parentOwnStop.nullable(),
  etaText: z.string().nullable(),
  approaching: z.boolean(),
  trackingEnded: z.boolean(),
});
export type ParentLiveTrip = z.infer<typeof parentLiveTrip>;

export const parentHomeChild = z.object({
  studentId: uuid,
  fullName: z.string(),
  schoolName: z.string(),
  morningPlanStatus: studentPlanStatus,
  eveningPlanStatus: studentPlanStatus,
  live: parentLiveTrip.nullable(),
  day: parentDayPlan.nullable(),
});
export type ParentHomeChild = z.infer<typeof parentHomeChild>;

export const parentHome = z.object({
  children: z.array(parentHomeChild),
});
export type ParentHome = z.infer<typeof parentHome>;

export const parentTrackingView = z.object({
  tripId: uuid,
  studentId: uuid,
  vehicle: vehicleBroadcast.nullable(),
  liveAvailable: z.boolean(),
  staleMessage: z.string().nullable(),
  ownStop: parentOwnStop.nullable(),
  etaText: z.string().nullable(),
  approaching: z.boolean(),
  trackingEnded: z.boolean(),
});
export type ParentTrackingView = z.infer<typeof parentTrackingView>;

export const devParentLoginInput = z.object({
  phone: phoneE164,
  password: z.string().min(16).max(200),
});
export type DevParentLoginInput = z.infer<typeof devParentLoginInput>;
