import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { devicePlatformEnum, membershipStatusEnum, roleEnum } from './enums.js';
import { tenantIsolation, tenantRowUnique } from './helpers.js';

export const tenant = pgTable(
  'tenant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Europe/Istanbul'),
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('tenant_self', {
      as: 'permissive',
      for: 'all',
      to: ['servisapp_api', 'servisapp_worker'],
      using: sql`id = (select app_tenant_id())`,
      withCheck: sql`id = (select app_tenant_id())`,
    }),
  ],
).enableRLS();

/**
 * Global kimlik. Aynı telefon iki şirkette veli, birinde şoför olabilir —
 * üyelik `tenant_membership` üzerindedir, bu tablo değildir.
 */
export const identity = pgTable(
  'identity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authUserId: uuid('auth_user_id'),
    phoneE164: text('phone_e164').notNull().unique(),
    email: text('email'),
    fullName: text('full_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('identity_auth_user_id_key')
      .on(t.authUserId)
      .where(sql`${t.authUserId} is not null`),
    uniqueIndex('identity_email_key')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    check('identity_phone_e164', sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    pgPolicy('identity_visible_via_membership', {
      as: 'permissive',
      for: 'select',
      to: ['servisapp_api', 'servisapp_worker'],
      using: sql`exists (
        select 1 from tenant_membership tm
        where tm.identity_id = identity.id
          and tm.tenant_id = (select app_tenant_id())
      )`,
    }),
    pgPolicy('identity_insert', {
      as: 'permissive',
      for: 'insert',
      to: ['servisapp_api', 'servisapp_worker'],
      withCheck: sql`true`,
    }),
    pgPolicy('identity_update_via_membership', {
      as: 'permissive',
      for: 'update',
      to: ['servisapp_api', 'servisapp_worker'],
      using: sql`exists (
        select 1 from tenant_membership tm
        where tm.identity_id = identity.id
          and tm.tenant_id = (select app_tenant_id())
      )`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const tenantMembership = pgTable(
  'tenant_membership',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => identity.id),
    status: membershipStatusEnum('status').notNull().default('INVITED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('tenant_membership_identity').on(t.tenantId, t.identityId),
    tenantRowUnique('tenant_membership', t.tenantId, t.id),
    tenantIsolation('tenant_membership'),
  ],
).enableRLS();

export const membershipRole = pgTable(
  'membership_role',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    membershipId: uuid('membership_id').notNull(),
    role: roleEnum('role').notNull(),
    /** Okul veya rota kapsamı; boşsa tenant geneli. Polimorfik — FK yok. */
    scopeId: uuid('scope_id'),
  },
  (t) => [
    unique('membership_role_unique').on(t.membershipId, t.role, t.scopeId).nullsNotDistinct(),
    foreignKey({
      name: 'membership_role_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    tenantIsolation('membership_role'),
  ],
).enableRLS();

export const device = pgTable(
  'device',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    membershipId: uuid('membership_id').notNull(),
    platform: devicePlatformEnum('platform').notNull(),
    pushToken: text('push_token'),
    appVersion: text('app_version'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantRowUnique('device', t.tenantId, t.id),
    foreignKey({
      name: 'device_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    tenantIsolation('device'),
  ],
).enableRLS();
