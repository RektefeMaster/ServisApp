import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  alertSeverityEnum,
  exceptionSourceEnum,
  notificationChannelEnum,
  notificationStatusEnum,
  requestStatusEnum,
  segmentEnum,
} from './enums.js';
import { tenantIsolation, tenantRowUnique } from './helpers.js';
import { tenant, tenantMembership } from './identity.js';
import { address, route, student } from './persistent.js';
import { trip, tripStop } from './trips.js';

export const rideException = pgTable(
  'ride_exception',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    studentId: uuid('student_id').notNull(),
    serviceDate: date('service_date').notNull(),
    segment: segmentEnum('segment').notNull(),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    source: exceptionSourceEnum('source').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ride_exception_active')
      .on(t.tenantId, t.studentId, t.serviceDate, t.segment)
      .where(sql`${t.cancelledAt} is null`),
    foreignKey({
      name: 'ride_exception_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
    }),
    foreignKey({
      name: 'ride_exception_actor_fk',
      columns: [t.tenantId, t.createdByMembershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    tenantIsolation('ride_exception'),
  ],
).enableRLS();

export const studentTripMove = pgTable(
  'student_trip_move',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    studentId: uuid('student_id').notNull(),
    serviceDate: date('service_date').notNull(),
    segment: segmentEnum('segment').notNull(),
    targetRouteId: uuid('target_route_id').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('student_trip_move_unique').on(t.tenantId, t.studentId, t.serviceDate, t.segment),
    foreignKey({
      name: 'student_trip_move_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
    }),
    foreignKey({
      name: 'student_trip_move_route_fk',
      columns: [t.tenantId, t.targetRouteId],
      foreignColumns: [route.tenantId, route.id],
    }),
    tenantIsolation('student_trip_move'),
  ],
).enableRLS();

export const addressChangeRequest = pgTable(
  'address_change_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    studentId: uuid('student_id').notNull(),
    proposedAddressId: uuid('proposed_address_id').notNull(),
    status: requestStatusEnum('status').notNull().default('PENDING'),
    effectiveFromDate: date('effective_from_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'address_change_request_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
    }),
    foreignKey({
      name: 'address_change_request_address_fk',
      columns: [t.tenantId, t.proposedAddressId],
      foreignColumns: [address.tenantId, address.id],
    }),
    tenantIsolation('address_change_request'),
  ],
).enableRLS();

export const criticalChangeAlert = pgTable(
  'critical_change_alert',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    tripId: uuid('trip_id').notNull(),
    severity: alertSeverityEnum('severity').notNull(),
    body: text('body').notNull(),
    requiresAckRoles: text('requires_ack_roles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tripStopId: uuid('trip_stop_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantRowUnique('critical_change_alert', t.tenantId, t.id),
    foreignKey({
      name: 'critical_change_alert_trip_fk',
      columns: [t.tenantId, t.tripId],
      foreignColumns: [trip.tenantId, trip.id],
    }),
    foreignKey({
      name: 'critical_change_alert_stop_fk',
      columns: [t.tenantId, t.tripStopId],
      foreignColumns: [tripStop.tenantId, tripStop.id],
    }),
    tenantIsolation('critical_change_alert'),
  ],
).enableRLS();

export const criticalChangeAck = pgTable(
  'critical_change_ack',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    alertId: uuid('alert_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    ackedAt: timestamp('acked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('critical_change_ack_pk').on(t.tenantId, t.alertId, t.membershipId),
    foreignKey({
      name: 'critical_change_ack_alert_fk',
      columns: [t.tenantId, t.alertId],
      foreignColumns: [criticalChangeAlert.tenantId, criticalChangeAlert.id],
    }),
    tenantIsolation('critical_change_ack'),
  ],
).enableRLS();

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    recipientMembershipId: uuid('recipient_membership_id').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    type: text('type').notNull(),
    tripId: uuid('trip_id'),
    studentId: uuid('student_id'),
    status: notificationStatusEnum('status').notNull().default('QUEUED'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('notification_dedupe').on(t.tenantId, t.dedupeKey),
    foreignKey({
      name: 'notification_recipient_fk',
      columns: [t.tenantId, t.recipientMembershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    tenantIsolation('notification'),
  ],
).enableRLS();
