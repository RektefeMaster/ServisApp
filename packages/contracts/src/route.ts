import { z } from 'zod';
import { coordinate, uuid } from './primitives.js';

export const tripSegment = z.enum(['MORNING', 'AFTERNOON']);
export type TripSegment = z.infer<typeof tripSegment>;

export const stopKind = z.enum(['PICKUP', 'DROPOFF', 'SCHOOL']);
export type StopKind = z.infer<typeof stopKind>;

export const routeVersionStatus = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export type RouteVersionStatus = z.infer<typeof routeVersionStatus>;

export const createStopInput = z.object({
  addressId: uuid,
  label: z.string().trim().min(2).max(80),
  lat: coordinate.shape.lat,
  lng: coordinate.shape.lng,
});
export type CreateStopInput = z.infer<typeof createStopInput>;

export const createRouteInput = z.object({
  vehicleId: uuid,
  schoolId: uuid,
  segment: tripSegment,
  shiftNo: z.number().int().min(1).max(10).default(1),
  maxDetourM: z.number().int().min(0).max(20_000).default(1500),
  effectiveFrom: z.iso.date(),
});
export type CreateRouteInput = z.infer<typeof createRouteInput>;

export const routeStopDraftInput = z.object({
  stopId: uuid,
  kind: stopKind,
  seq: z.number().int().min(1).max(80),
  studentIds: z.array(uuid).max(80).default([]),
});
export type RouteStopDraftInput = z.infer<typeof routeStopDraftInput>;

export const replaceRouteStopsInput = z.object({
  stops: z.array(routeStopDraftInput).min(1).max(80),
});
export type ReplaceRouteStopsInput = z.infer<typeof replaceRouteStopsInput>;

export const cloneRouteVersionInput = z.object({
  fromVersionId: uuid.optional(),
});
export type CloneRouteVersionInput = z.infer<typeof cloneRouteVersionInput>;
