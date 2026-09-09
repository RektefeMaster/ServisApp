import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { overrideStatusEnum } from './enums.js';
import { bytea, tenantIsolation, tenantRowUnique } from './helpers.js';
import { tenant, tenantMembership } from './identity.js';
import { address, student } from './persistent.js';

/**
 * OTP kodu, HMAC'i ve ciphertext'i personel cihazına hiç gitmez.
 * Doğrulama Fastify'da; bu tablo yalnız kilit + atomik durum taşır.
 */
export const deliveryOverride = pgTable(
  'delivery_override',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    studentId: uuid('student_id').notNull(),
    serviceDate: date('service_date').notNull(),
    addressId: uuid('address_id').notNull(),
    receiverName: text('receiver_name').notNull(),
    receiverPhone: text('receiver_phone').notNull(),
    otpHmac: bytea('otp_hmac'),
    otpCiphertext: bytea('otp_ciphertext'),
    otpExpiresAt: timestamp('otp_expires_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    resendCount: integer('resend_count').notNull().default(0),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by'),
    status: overrideStatusEnum('status').notNull().default('PENDING_APPROVAL'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantRowUnique('delivery_override', t.tenantId, t.id),
    foreignKey({
      name: 'delivery_override_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
    }),
    foreignKey({
      name: 'delivery_override_address_fk',
      columns: [t.tenantId, t.addressId],
      foreignColumns: [address.tenantId, address.id],
    }),
    foreignKey({
      name: 'delivery_override_verified_by_fk',
      columns: [t.tenantId, t.verifiedBy],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    uniqueIndex('delivery_override_active')
      .on(t.tenantId, t.studentId, t.serviceDate)
      .where(sql`${t.status} in ('PENDING_APPROVAL', 'ACTIVE', 'LOCKED')`),
    tenantIsolation('delivery_override'),
  ],
).enableRLS();
