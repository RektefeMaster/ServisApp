import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorRoleEnum, commandStatusEnum } from './enums.js';
import { tenantIsolation } from './helpers.js';
import { device, tenant, tenantMembership } from './identity.js';
import { vehicle } from './persistent.js';
import { trip } from './trips.js';

/**
 * Append-only denetim izi. Uygulama rolünün UPDATE/DELETE yetkisi yoktur.
 * Aylık partition SQL migration'ında.
 */
export const event = pgTable(
  'event',
  {
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    occurredAtServer: timestamp('occurred_at_server', { withTimezone: true })
      .notNull()
      .defaultNow(),
    occurredAtDevice: timestamp('occurred_at_device', { withTimezone: true }),
    actorMembershipId: uuid('actor_membership_id'),
    actorRole: actorRoleEnum('actor_role'),
    deviceId: uuid('device_id'),
    vehicleId: uuid('vehicle_id'),
    tripId: uuid('trip_id'),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    eventType: text('event_type').notNull(),
    prevState: text('prev_state'),
    newState: text('new_state'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    sourceCommandId: uuid('source_command_id'),
    isUndoOfEventId: bigint('is_undo_of_event_id', { mode: 'number' }),
    appVersion: text('app_version'),
    lateArrival: boolean('late_arrival').notNull().default(false),
  },
  (t) => [
    unique('event_pk').on(t.seq, t.occurredAtServer),
    index('event_tenant_occurred_idx').on(t.tenantId, t.occurredAtServer),
    foreignKey({
      name: 'event_actor_fk',
      columns: [t.tenantId, t.actorMembershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    foreignKey({
      name: 'event_device_fk',
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [device.tenantId, device.id],
    }),
    foreignKey({
      name: 'event_trip_fk',
      columns: [t.tenantId, t.tripId],
      foreignColumns: [trip.tenantId, trip.id],
    }),
    foreignKey({
      name: 'event_vehicle_fk',
      columns: [t.tenantId, t.vehicleId],
      foreignColumns: [vehicle.tenantId, vehicle.id],
    }),
    tenantIsolation('event'),
  ],
).enableRLS();

export const commandReceipt = pgTable(
  'command_receipt',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    clientEventId: uuid('client_event_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    deviceSeq: integer('device_seq'),
    commandType: text('command_type').notNull(),
    status: commandStatusEnum('status').notNull().default('PENDING'),
    responseJson: jsonb('response_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('command_receipt_pk').on(t.tenantId, t.clientEventId),
    tenantIsolation('command_receipt'),
  ],
).enableRLS();

export const pendingCommandDependency = pgTable(
  'pending_command_dependency',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    clientEventId: uuid('client_event_id').notNull(),
    targetClientEventId: uuid('target_client_event_id').notNull(),
    commandType: text('command_type').notNull(),
    payload: jsonb('payload').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('pending_command_dependency_pk').on(t.tenantId, t.clientEventId),
    tenantIsolation('pending_command_dependency'),
  ],
).enableRLS();
