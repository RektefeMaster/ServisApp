import { z } from 'zod';
import { phoneE164, uuid } from './primitives.js';

export const studentPlanStatus = z.enum(['PREPARING', 'READY', 'NO_SERVICE', 'SUSPENDED']);
export type StudentPlanStatus = z.infer<typeof studentPlanStatus>;

export const guardianRelationStatus = z.enum(['ACTIVE', 'REVOKED']);
export type GuardianRelationStatus = z.infer<typeof guardianRelationStatus>;

export const importRowStatus = z.enum([
  'PENDING',
  'READY',
  'NEEDS_FIX',
  'ADDRESS_UNVERIFIED',
  'COMMITTED',
  'FAILED',
]);
export type ImportRowStatus = z.infer<typeof importRowStatus>;

export const inviteStatus = z.enum(['PENDING', 'USED', 'EXPIRED', 'REVOKED']);
export type InviteStatus = z.infer<typeof inviteStatus>;

export const smsDeliveryStatus = z.enum(['QUEUED', 'SENT', 'DELIVERED', 'FAILED']);
export type SmsDeliveryStatus = z.infer<typeof smsDeliveryStatus>;

export const importRowInput = z.object({
  rowNo: z.number().int().positive(),
  studentFullName: z.string().trim().min(2).max(200),
  schoolId: uuid,
  grade: z.string().trim().max(20).optional(),
  handoverPolicy: z.enum(['GUARDIAN_REQUIRED', 'MAY_LEAVE_ALONE']).default('GUARDIAN_REQUIRED'),
  enrollmentStart: z.iso.date(),
  usesMorning: z.boolean().default(true),
  usesEvening: z.boolean().default(true),
  guardianFullName: z.string().trim().min(2).max(200),
  guardianPhone: phoneE164,
  relation: z.string().trim().min(2).max(50),
  isPrimary: z.boolean().default(true),
  reuseIdentityId: uuid.optional(),
  pickupAddressText: z.string().trim().min(3).max(500).optional(),
  dropoffAddressText: z.string().trim().min(3).max(500).optional(),
});
export type ImportRowInput = z.infer<typeof importRowInput>;

export const previewImportInput = z.object({
  fileName: z.string().trim().min(1).max(200).optional(),
  fileHash: z.string().trim().min(8).max(128).optional(),
  rows: z.array(importRowInput).min(1).max(500),
});
export type PreviewImportInput = z.infer<typeof previewImportInput>;

export const commitImportInput = z.object({
  onlyReady: z.boolean().default(true),
  includeAddressUnverified: z.boolean().default(false),
});
export type CommitImportInput = z.infer<typeof commitImportInput>;

export const createInviteInput = z.object({
  membershipId: uuid,
});
export type CreateInviteInput = z.infer<typeof createInviteInput>;

export const activateInviteInput = z.object({
  token: z.string().trim().min(16).max(200),
});
export type ActivateInviteInput = z.infer<typeof activateInviteInput>;

export const changeUnactivatedPhoneInput = z.object({
  phone: phoneE164,
});
export type ChangeUnactivatedPhoneInput = z.infer<typeof changeUnactivatedPhoneInput>;

export const revokeGuardianInput = z.object({
  status: z.literal('REVOKED'),
});
export type RevokeGuardianInput = z.infer<typeof revokeGuardianInput>;

export const endStudentInput = z.object({
  enrollmentEnd: z.iso.date(),
});
export type EndStudentInput = z.infer<typeof endStudentInput>;
