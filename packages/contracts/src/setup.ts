import { z } from 'zod';
import { coordinate, phoneE164, uuid } from './primitives.js';

export const membershipRole = z.enum(['ADMIN', 'DRIVER', 'ATTENDANT', 'GUARDIAN']);
export type MembershipRole = z.infer<typeof membershipRole>;

export const clientKind = z.enum(['crew', 'parent', 'admin']);
export type ClientKind = z.infer<typeof clientKind>;

export const platformConfig = z.object({
  schemaVersion: z.number().int().positive(),
  minSupportedAppVersion: z.string(),
  kills: z.object({
    gps: z.boolean(),
    otp: z.boolean(),
    realtime: z.boolean(),
  }),
  flags: z.record(z.string(), z.boolean()),
});
export type PlatformConfig = z.infer<typeof platformConfig>;

export const sessionMembership = z.object({
  membershipId: uuid,
  tenantId: uuid,
  tenantName: z.string(),
  status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'REVOKED']),
  roles: z.array(membershipRole),
});
export type SessionMembership = z.infer<typeof sessionMembership>;

export const sessionSnapshot = z.object({
  identityId: uuid,
  fullName: z.string(),
  phone: phoneE164,
  email: z.string().email().nullable(),
  memberships: z.array(sessionMembership),
});
export type SessionSnapshot = z.infer<typeof sessionSnapshot>;

export const schoolLevel = z.enum(['PRESCHOOL', 'PRIMARY', 'SECONDARY', 'HIGH']);
export const handoverPolicy = z.enum(['GUARDIAN_REQUIRED', 'MAY_LEAVE_ALONE']);
export const staffRole = z.enum(['ADMIN', 'DRIVER', 'ATTENDANT']);

export const pinAddressInput = z.object({
  text: z.string().trim().min(3).max(500),
  il: z.string().trim().min(2).max(50),
  ilce: z.string().trim().min(2).max(50),
  lat: coordinate.shape.lat,
  lng: coordinate.shape.lng,
  geocodeConfidence: z.number().min(0).max(1).optional(),
  studentId: uuid.optional(),
  usage: z.enum(['PICKUP', 'DROPOFF']).optional(),
});
export type PinAddressInput = z.infer<typeof pinAddressInput>;

export const createSchoolInput = z.object({
  name: z.string().trim().min(2).max(200),
  level: schoolLevel,
  addressId: uuid,
  attendantRequired: z.boolean().default(true),
});
export type CreateSchoolInput = z.infer<typeof createSchoolInput>;

export const createVehicleInput = z.object({
  plate: z.string().trim().min(2).max(20),
  seatCount: z.number().int().positive().max(100),
  modelYear: z.number().int().min(1990).max(2100).optional(),
  inspectionExpiry: z.iso.date().optional(),
  insuranceExpiry: z.iso.date().optional(),
});
export type CreateVehicleInput = z.infer<typeof createVehicleInput>;

export const createStaffInput = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: phoneE164,
  email: z.string().email(),
  role: staffRole,
  vehicleId: uuid.optional(),
  validFrom: z.iso.date().optional(),
  reuseIdentityId: uuid.optional(),
});
export type CreateStaffInput = z.infer<typeof createStaffInput>;

export const setStaffStatusInput = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']),
});
export type SetStaffStatusInput = z.infer<typeof setStaffStatusInput>;

export const revokeDeviceInput = z.object({
  deviceId: uuid,
});
export type RevokeDeviceInput = z.infer<typeof revokeDeviceInput>;

export const createStudentInput = z.object({
  fullName: z.string().trim().min(2).max(200),
  schoolId: uuid,
  grade: z.string().trim().max(20).optional(),
  handoverPolicy: handoverPolicy,
  enrollmentStart: z.iso.date(),
  usesMorning: z.boolean().default(true),
  usesEvening: z.boolean().default(true),
  pickupAddressId: uuid.optional(),
  dropoffAddressId: uuid.optional(),
});
export type CreateStudentInput = z.infer<typeof createStudentInput>;

export const createGuardianInput = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: phoneE164,
  relation: z.string().trim().min(2).max(50),
  isPrimary: z.boolean().default(false),
  canReceiveChild: z.boolean().default(true),
  canAuthorizeTempAddress: z.boolean().default(false),
  canSubmitException: z.boolean().default(true),
  notifyAm: z.boolean().default(true),
  notifyPm: z.boolean().default(true),
  /** Aynı telefon + farklı isimde zorunlu. Kör merge yok. */
  reuseIdentityId: uuid.optional(),
});
export type CreateGuardianInput = z.infer<typeof createGuardianInput>;
