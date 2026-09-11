import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { importRowStatusEnum, inviteStatusEnum, notificationStatusEnum } from './enums.js';
import { bytea, tenantIsolation, tenantRowUnique } from './helpers.js';
import { identity, tenant, tenantMembership } from './identity.js';

/** Excel/manuel önizleme. Commit edilmeden student/identity yazılmaz. */
export const importBatch = pgTable(
  'import_batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    fileName: text('file_name'),
    fileHash: text('file_hash'),
    createdByMembershipId: uuid('created_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantRowUnique('import_batch', t.tenantId, t.id),
    uniqueIndex('import_batch_file_hash')
      .on(t.tenantId, t.fileHash)
      .where(sql`${t.fileHash} is not null`),
    tenantIsolation('import_batch'),
  ],
).enableRLS();

export const importBatchRow = pgTable(
  'import_batch_row',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    batchId: uuid('batch_id').notNull(),
    rowNo: integer('row_no').notNull(),
    raw: jsonb('raw')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: importRowStatusEnum('status').notNull().default('PENDING'),
    errorCode: text('error_code'),
    existingIdentityId: uuid('existing_identity_id'),
    existingFullName: text('existing_full_name'),
    studentId: uuid('student_id'),
    identityId: uuid('identity_id'),
    membershipId: uuid('membership_id'),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => [
    tenantRowUnique('import_batch_row', t.tenantId, t.id),
    unique('import_batch_row_no').on(t.tenantId, t.batchId, t.rowNo),
    check('import_batch_row_row_no', sql`${t.rowNo} >= 1`),
    foreignKey({
      name: 'import_batch_row_batch_fk',
      columns: [t.tenantId, t.batchId],
      foreignColumns: [importBatch.tenantId, importBatch.id],
    }),
    index('import_batch_row_batch_idx').on(t.tenantId, t.batchId),
    tenantIsolation('import_batch_row'),
  ],
).enableRLS();

/** Davet kişi/üyelik seviyesinde; student_id yok. */
export const guardianInvite = pgTable(
  'guardian_invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => identity.id),
    membershipId: uuid('membership_id').notNull(),
    tokenHash: bytea('token_hash').notNull(),
    tokenCiphertext: bytea('token_ciphertext'),
    status: inviteStatusEnum('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdByMembershipId: uuid('created_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantRowUnique('guardian_invite', t.tenantId, t.id),
    uniqueIndex('guardian_invite_one_pending')
      .on(t.tenantId, t.membershipId)
      .where(sql`${t.status} = 'PENDING'`),
    index('guardian_invite_token_hash_idx').on(t.tokenHash),
    foreignKey({
      name: 'guardian_invite_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    tenantIsolation('guardian_invite'),
    pgPolicy('guardian_invite_definer_lookup', {
      as: 'permissive',
      for: 'all',
      to: ['servisapp_definer'],
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();

export const inviteSms = pgTable(
  'invite_sms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    inviteId: uuid('invite_id').notNull(),
    status: notificationStatusEnum('status').notNull().default('QUEUED'),
    provider: text('provider').notNull().default('dev'),
    bodyCiphertext: bytea('body_ciphertext'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantRowUnique('invite_sms', t.tenantId, t.id),
    foreignKey({
      name: 'invite_sms_invite_fk',
      columns: [t.tenantId, t.inviteId],
      foreignColumns: [guardianInvite.tenantId, guardianInvite.id],
    }),
    index('invite_sms_invite_idx').on(t.tenantId, t.inviteId),
    tenantIsolation('invite_sms'),
  ],
).enableRLS();
