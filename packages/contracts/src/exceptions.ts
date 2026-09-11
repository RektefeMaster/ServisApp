import { z } from 'zod';
import { coordinate, phoneE164, serviceDate, uuid } from './primitives.js';
import { tripSegment } from './route.js';

export const exceptionSource = z.enum(['PARENT', 'STAFF', 'ADMIN']);
export const overrideStatus = z.enum([
  'PENDING_APPROVAL',
  'ACTIVE',
  'VERIFIED',
  'CANCELLED',
  'EXPIRED',
  'LOCKED',
]);
export type OverrideStatus = z.infer<typeof overrideStatus>;

export const requestStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export const alertSeverity = z.enum(['INFO', 'WARNING', 'CRITICAL']);

export const createRideExceptionInput = z.object({
  studentId: uuid,
  serviceDate,
  segments: z.array(tripSegment).min(1).max(2),
});
export type CreateRideExceptionInput = z.infer<typeof createRideExceptionInput>;

export const createDeliveryOverrideInput = z.object({
  studentId: uuid,
  serviceDate,
  lat: coordinate.shape.lat,
  lng: coordinate.shape.lng,
  addressText: z.string().trim().min(3).max(500),
  receiverName: z.string().trim().min(2).max(120),
  receiverPhone: phoneE164,
});
export type CreateDeliveryOverrideInput = z.infer<typeof createDeliveryOverrideInput>;

export const verifyDeliveryOtpInput = z.object({
  tripStudentId: uuid,
  code: z.string().regex(/^\d{6}$/, 'Kod 6 haneli olmalı'),
});
export type VerifyDeliveryOtpInput = z.infer<typeof verifyDeliveryOtpInput>;

export const ackCriticalChangeInput = z.object({
  alertId: uuid,
});
export type AckCriticalChangeInput = z.infer<typeof ackCriticalChangeInput>;

export const createAddressChangeInput = z.object({
  studentId: uuid,
  lat: coordinate.shape.lat,
  lng: coordinate.shape.lng,
  addressText: z.string().trim().min(3).max(500),
  effectiveFromDate: serviceDate,
});
export type CreateAddressChangeInput = z.infer<typeof createAddressChangeInput>;

export const adminOverrideDeliveryInput = z.object({
  tripStudentId: uuid,
  reason: z.string().trim().min(3).max(500),
});
export type AdminOverrideDeliveryInput = z.infer<typeof adminOverrideDeliveryInput>;

export const rideExceptionView = z.object({
  id: uuid,
  studentId: uuid,
  studentName: z.string(),
  serviceDate,
  segment: tripSegment,
  source: exceptionSource,
  cancelledAt: z.string().nullable(),
});
export type RideExceptionView = z.infer<typeof rideExceptionView>;

export const deliveryOverrideView = z.object({
  id: uuid,
  studentId: uuid,
  studentName: z.string(),
  serviceDate,
  status: overrideStatus,
  receiverName: z.string(),
  addressText: z.string(),
  detourM: z.number(),
  maxDetourM: z.number(),
  /** Yalnız veli yanıtında; personel/admin listesinde asla yok. */
  otpCode: z.string().regex(/^\d{6}$/).nullable(),
});
export type DeliveryOverrideView = z.infer<typeof deliveryOverrideView>;

export const adminDeliveryOverrideView = deliveryOverrideView.omit({ otpCode: true });
export type AdminDeliveryOverrideView = z.infer<typeof adminDeliveryOverrideView>;

export const addressChangeView = z.object({
  id: uuid,
  studentId: uuid,
  studentName: z.string(),
  status: requestStatus,
  addressText: z.string(),
  effectiveFromDate: serviceDate,
});
export type AddressChangeView = z.infer<typeof addressChangeView>;

export const criticalAlertView = z.object({
  id: uuid,
  tripId: uuid,
  body: z.string(),
  severity: alertSeverity,
  stopId: uuid.nullable(),
  requiresAck: z.boolean(),
});
export type CriticalAlertView = z.infer<typeof criticalAlertView>;

export const adminExceptionsList = z.object({
  available: z.literal(true),
  exceptions: z.array(rideExceptionView),
  overrides: z.array(adminDeliveryOverrideView),
  addressChanges: z.array(addressChangeView),
});
export type AdminExceptionsList = z.infer<typeof adminExceptionsList>;

export const parentDayPlan = z.object({
  morningAbsent: z.boolean(),
  eveningAbsent: z.boolean(),
  morningExceptionId: uuid.nullable(),
  eveningExceptionId: uuid.nullable(),
  deliveryOverride: deliveryOverrideView.nullable(),
});
export type ParentDayPlan = z.infer<typeof parentDayPlan>;

/** Boşsa kiracı takviminde bugün. Geçmiş gün yok. */
export const parentDayQuery = z.object({
  date: serviceDate.optional(),
});
export type ParentDayQuery = z.infer<typeof parentDayQuery>;
