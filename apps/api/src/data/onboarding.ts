import { createHash } from 'node:crypto';
import {
  importRowInput,
  type CommitImportInput,
  type ImportRowInput,
  type PreviewImportInput,
} from '@servisapp/contracts';
import { namesLikelySame } from '@servisapp/domain';
import {
  guardianInvite,
  identity,
  importBatch,
  importBatchRow,
  inviteSms,
  membershipRole,
  school,
  student,
  studentGuardian,
  tenantMembership,
  withTenant,
  type Database,
} from '@servisapp/db';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { conflict, HttpError, notFound } from '../http-error.js';
import { attachMembership, findIdentityByPhone, identityBelongsToTenant, resolveGuardianIdentity } from './identity-write.js';
import { hashInviteToken, inviteExpiresAt, newInviteToken, phoneHint } from './invite-token.js';
import { loadParentChildren } from './plan-query.js';
import type {
  GuardianInviteView,
  ImportBatchView,
  ImportRowView,
  ParentChildView,
  PublicInviteView,
} from './ports.js';
import { asText, firstRow, jsonObject } from './sql-result.js';
import { mapDbError } from './db-error.js';

export interface OnboardingOptions {
  invitePepper: string;
  publicAppUrl: string;
  revealInviteSecrets: boolean;
}

function adminCtx(tenantId: string) {
  return { tenantId, membershipId: '', role: 'ADMIN' as const };
}

async function withAdmin<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await withTenant(db, adminCtx(tenantId), fn);
  } catch (error) {
    mapDbError(error);
  }
}

function asImportRow(raw: unknown): ImportRowInput | null {
  const parsed = importRowInput.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function shouldCommitRow(
  status: ImportRowView['status'],
  input: CommitImportInput,
): boolean {
  switch (status) {
    case 'COMMITTED':
    case 'NEEDS_FIX':
      return false;
    case 'ADDRESS_UNVERIFIED':
      return input.includeAddressUnverified;
    case 'READY':
      return true;
    case 'FAILED':
    case 'PENDING':
      return true;
    default: {
      const unexpected: never = status;
      void unexpected;
      return false;
    }
  }
}

function phoneOf(raw: unknown): string | null {
  const row = asImportRow(raw);
  return row?.guardianPhone ?? null;
}

function importRowsHash(rows: ImportRowInput[]): string {
  const canonical = [...rows]
    .sort((left, right) => left.rowNo - right.rowNo)
    .map((row) => JSON.stringify(row))
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function invitePublicUrl(publicAppUrl: string, token: string): string {
  const base = publicAppUrl.replace(/\/$/, '');
  if (base.length > 0) return `${base}/i/${token}`;
  return `/i/${token}`;
}

function inviteInvalid(): never {
  throw new HttpError(404, 'invite_invalid', 'Davet geçersiz');
}

export function createOnboarding(db: Database, options: OnboardingOptions) {
  return {
    previewImport(tenantId: string, actorMembershipId: string, input: PreviewImportInput) {
      return withAdmin(db, tenantId, async (tx) => {
        const fileHash = importRowsHash(input.rows);
        const [existing] = await tx
          .select({ id: importBatch.id })
          .from(importBatch)
          .where(and(eq(importBatch.tenantId, tenantId), eq(importBatch.fileHash, fileHash)));
        let batchId = existing?.id;
        if (!batchId) {
          const [created] = await tx
            .insert(importBatch)
            .values({
              tenantId,
              fileName: input.fileName,
              fileHash,
              createdByMembershipId: actorMembershipId,
            })
            .returning({ id: importBatch.id });
          if (!created) throw new HttpError(500, 'insert_failed', 'İçe aktarma açılamadı');
          batchId = created.id;
        }

        for (const row of input.rows) {
          const classified = await classifyRow(tx, tenantId, row);
          const [present] = await tx
            .select({
              id: importBatchRow.id,
              status: importBatchRow.status,
            })
            .from(importBatchRow)
            .where(
              and(
                eq(importBatchRow.tenantId, tenantId),
                eq(importBatchRow.batchId, batchId),
                eq(importBatchRow.rowNo, row.rowNo),
              ),
            );
          if (present?.status === 'COMMITTED') continue;
          if (present) {
            await tx
              .update(importBatchRow)
              .set({
                raw: row,
                status: classified.status,
                errorCode: classified.errorCode,
                existingIdentityId: classified.existingIdentityId,
                existingFullName: classified.existingFullName,
              })
              .where(and(eq(importBatchRow.id, present.id), eq(importBatchRow.tenantId, tenantId)));
          } else {
            await tx.insert(importBatchRow).values({
              tenantId,
              batchId,
              rowNo: row.rowNo,
              raw: row,
              status: classified.status,
              errorCode: classified.errorCode,
              existingIdentityId: classified.existingIdentityId,
              existingFullName: classified.existingFullName,
            });
          }
        }
        const id = batchId;
        if (!id) throw new HttpError(500, 'insert_failed', 'İçe aktarma açılamadı');
        return loadBatchOrThrow(tx, tenantId, id);
      });
    },

    getImport(tenantId: string, batchId: string) {
      return withAdmin(db, tenantId, (tx) => loadBatch(tx, tenantId, batchId));
    },

    async commitImport(tenantId: string, batchId: string, input: CommitImportInput) {
      const snapshot = await withAdmin(db, tenantId, (tx) => loadBatch(tx, tenantId, batchId));
      if (!snapshot) throw notFound('İçe aktarma bulunamadı');
      const targets = snapshot.rows.filter((row) => shouldCommitRow(row.status, input));
      for (const row of targets) {
        try {
          await withAdmin(db, tenantId, (tx) => commitOneRow(tx, tenantId, batchId, row.rowNo));
        } catch (error) {
          const code = error instanceof HttpError ? error.code : 'commit_failed';
          await withAdmin(db, tenantId, async (tx) => {
            await tx
              .update(importBatchRow)
              .set({ status: 'FAILED', errorCode: code })
              .where(
                and(
                  eq(importBatchRow.tenantId, tenantId),
                  eq(importBatchRow.batchId, batchId),
                  eq(importBatchRow.rowNo, row.rowNo),
                ),
              );
          });
        }
      }
      const next = await withAdmin(db, tenantId, (tx) => loadBatch(tx, tenantId, batchId));
      if (!next) throw notFound('İçe aktarma bulunamadı');
      return next;
    },

    createInvite(tenantId: string, actorMembershipId: string, membershipId: string) {
      return withAdmin(db, tenantId, async (tx) => {
        const token = newInviteToken();
        return insertInvite(tx, options, tenantId, actorMembershipId, membershipId, token);
      });
    },

    sendInviteSms(tenantId: string, inviteId: string) {
      return withAdmin(db, tenantId, async (tx) => {
        const [invite] = await tx
          .select()
          .from(guardianInvite)
          .where(and(eq(guardianInvite.id, inviteId), eq(guardianInvite.tenantId, tenantId)));
        if (!invite) throw notFound('Davet bulunamadı');
        if (invite.status !== 'PENDING') {
          throw conflict('invite_not_pending', 'Yalnız bekleyen davete SMS gönderilir');
        }
        if (invite.expiresAt.getTime() <= Date.now()) {
          await tx
            .update(guardianInvite)
            .set({ status: 'EXPIRED' })
            .where(and(eq(guardianInvite.id, invite.id), eq(guardianInvite.tenantId, tenantId)));
          throw conflict('invite_inactive', 'Davet süresi dolmuş');
        }
        const cooldownFrom = new Date(Date.now() - 90_000);
        const [recentSms] = await tx
          .select({ id: inviteSms.id })
          .from(inviteSms)
          .where(
            and(
              eq(inviteSms.inviteId, inviteId),
              eq(inviteSms.tenantId, tenantId),
              gte(inviteSms.createdAt, cooldownFrom),
            ),
          )
          .limit(1);
        if (recentSms) {
          throw conflict('sms_rate_limited', 'SMS en fazla 90 saniyede bir gönderilir');
        }
        const [sms] = await tx
          .insert(inviteSms)
          .values({
            tenantId,
            inviteId,
            status: 'QUEUED',
            provider: 'dev',
          })
          .returning({ id: inviteSms.id });
        if (!sms) throw new HttpError(500, 'insert_failed', 'SMS kuyruğa alınamadı');
        await tx
          .update(inviteSms)
          .set({ status: 'SENT', updatedAt: new Date() })
          .where(and(eq(inviteSms.id, sms.id), eq(inviteSms.tenantId, tenantId)));
        return toInviteView(tx, options, tenantId, invite.id, null);
      });
    },

    async previewInvite(token: string): Promise<PublicInviteView | null> {
      const found = await lookupInvite(db, options.invitePepper, token);
      if (!found) return null;
      return {
        tenantName: found.tenantName,
        phoneHint: phoneHint(found.phone),
        status: found.status,
      };
    },

    async activateInvite(
      token: string,
      auth: { authUserId: string; phone: string | null; identityId: string },
    ): Promise<{ membershipId: string; children: ParentChildView[] }> {
      const found = await lookupInvite(db, options.invitePepper, token);
      if (!found) inviteInvalid();
      if (found.status === 'EXPIRED' || found.status === 'REVOKED') {
        inviteInvalid();
      }
      if (!auth.phone || auth.phone !== found.phone) {
        inviteInvalid();
      }
      try {
        return await withTenant(
          db,
          {
            tenantId: found.tenantId,
            membershipId: found.membershipId,
            identityId: found.identityId,
            role: 'GUARDIAN',
          },
          async (tx) => {
            await tx.execute(
              sql`select id from identity where id = ${found.identityId}::uuid for update`,
            );
            const [person] = await tx
              .select({
                id: identity.id,
                authUserId: identity.authUserId,
                phone: identity.phoneE164,
              })
              .from(identity)
              .where(eq(identity.id, found.identityId));
            if (!person || person.phone !== found.phone) inviteInvalid();
            if (person.authUserId && person.authUserId !== auth.authUserId) {
              inviteInvalid();
            }
            const [membership] = await tx
              .select({
                id: tenantMembership.id,
                status: tenantMembership.status,
              })
              .from(tenantMembership)
              .where(
                and(
                  eq(tenantMembership.id, found.membershipId),
                  eq(tenantMembership.tenantId, found.tenantId),
                ),
              );
            if (!membership) inviteInvalid();
            switch (membership.status) {
              case 'SUSPENDED':
              case 'REVOKED':
                inviteInvalid();
                break;
              case 'INVITED':
              case 'ACTIVE':
                break;
              default: {
                const unexpected: never = membership.status;
                void unexpected;
                throw new Error('unknown membership status');
              }
            }
            if (!person.authUserId) {
              await tx
                .update(identity)
                .set({ authUserId: auth.authUserId })
                .where(eq(identity.id, found.identityId));
            }
            if (found.status === 'PENDING') {
              await tx
                .update(guardianInvite)
                .set({ status: 'USED', usedAt: new Date() })
                .where(
                  and(eq(guardianInvite.id, found.id), eq(guardianInvite.tenantId, found.tenantId)),
                );
            }
            if (membership.status === 'INVITED') {
              await tx
                .update(tenantMembership)
                .set({ status: 'ACTIVE' })
                .where(
                  and(
                    eq(tenantMembership.id, membership.id),
                    eq(tenantMembership.tenantId, found.tenantId),
                  ),
                );
            }
            const [next] = await tx
              .select({ status: tenantMembership.status })
              .from(tenantMembership)
              .where(
                and(
                  eq(tenantMembership.id, membership.id),
                  eq(tenantMembership.tenantId, found.tenantId),
                ),
              );
            const children = await loadParentChildren(
              tx,
              found.tenantId,
              membership.id,
              next?.status ?? membership.status,
            );
            return { membershipId: membership.id, children };
          },
        );
      } catch (error) {
        mapDbError(error);
      }
    },

    changeUnactivatedPhone(tenantId: string, identityId: string, phone: string) {
      return withAdmin(db, tenantId, async (tx) => {
        const [row] = await tx
          .select({
            id: identity.id,
            authUserId: identity.authUserId,
          })
          .from(identity)
          .innerJoin(
            tenantMembership,
            and(eq(tenantMembership.identityId, identity.id), eq(tenantMembership.tenantId, tenantId)),
          )
          .where(eq(identity.id, identityId));
        if (!row) throw notFound('Kişi bulunamadı');
        if (row.authUserId) {
          throw conflict(
            'phone_change_requires_support',
            'Aktive olmuş kullanıcıda telefon değişikliği admin destek akışıdır',
          );
        }
        const sharedResult: unknown = await tx.execute(
          sql`select identity_has_other_tenants(${identityId}::uuid, ${tenantId}::uuid) as shared`,
        );
        if (firstRow(sharedResult)?.['shared'] === true) {
          throw conflict(
            'identity_shared',
            'Bu kişi başka şirkette de üye; telefon buradan değişmez',
          );
        }
        const clash = await findIdentityByPhone(tx, phone);
        if (clash && clash.id !== identityId) {
          throw conflict('phone_in_use', 'Bu telefon mevcut bir kişide kullanılıyor');
        }
        await tx.update(identity).set({ phoneE164: phone }).where(eq(identity.id, identityId));
        await tx
          .update(guardianInvite)
          .set({ status: 'REVOKED' })
          .where(
            and(
              eq(guardianInvite.tenantId, tenantId),
              eq(guardianInvite.identityId, identityId),
              eq(guardianInvite.status, 'PENDING'),
            ),
          );
        return { identityId, phone };
      });
    },
  };
}

async function classifyRow(
  tx: Database,
  tenantId: string,
  row: ImportRowInput,
): Promise<{
  status: ImportRowView['status'];
  errorCode: string | null;
  existingIdentityId: string | null;
  existingFullName: string | null;
}> {
  const existing = await findIdentityByPhone(tx, row.guardianPhone);
  const sameTenant = existing
    ? await identityBelongsToTenant(tx, tenantId, existing.id)
    : false;
  const visibleId = existing && sameTenant ? existing.id : null;
  const visibleName = existing && sameTenant ? existing.fullName : null;
  if (existing) {
    const reuseOk =
      row.reuseIdentityId === existing.id || namesLikelySame(existing.fullName, row.guardianFullName);
    if (!reuseOk) {
      return {
        status: 'NEEDS_FIX',
        errorCode: 'phone_in_use',
        existingIdentityId: visibleId,
        existingFullName: visibleName,
      };
    }
  }
  const [owned] = await tx
    .select({ id: school.id })
    .from(school)
    .where(and(eq(school.id, row.schoolId), eq(school.tenantId, tenantId)));
  if (!owned) {
    return {
      status: 'NEEDS_FIX',
      errorCode: 'school_not_found',
      existingIdentityId: visibleId,
      existingFullName: visibleName,
    };
  }
  return {
    status: 'READY',
    errorCode: null,
    existingIdentityId: visibleId,
    existingFullName: visibleName,
  };
}

async function commitOneRow(
  tx: Database,
  tenantId: string,
  batchId: string,
  rowNo: number,
): Promise<void> {
  await tx.execute(
    sql`select id from import_batch_row
        where tenant_id = ${tenantId}::uuid
          and batch_id = ${batchId}::uuid
          and row_no = ${rowNo}
        for update`,
  );
  const [row] = await tx
    .select()
    .from(importBatchRow)
    .where(
      and(
        eq(importBatchRow.tenantId, tenantId),
        eq(importBatchRow.batchId, batchId),
        eq(importBatchRow.rowNo, rowNo),
      ),
    );
  if (!row || row.status === 'COMMITTED') return;
  const parsed = asImportRow(row.raw);
  if (!parsed) {
    await tx
      .update(importBatchRow)
      .set({ status: 'FAILED', errorCode: 'invalid_row' })
      .where(eq(importBatchRow.id, row.id));
    return;
  }
  const classified = await classifyRow(tx, tenantId, parsed);
  if (classified.status === 'NEEDS_FIX') {
    await tx
      .update(importBatchRow)
      .set({
        status: 'NEEDS_FIX',
        errorCode: classified.errorCode,
        existingIdentityId: classified.existingIdentityId,
        existingFullName: classified.existingFullName,
      })
      .where(eq(importBatchRow.id, row.id));
    return;
  }
  const [created] = await tx
    .insert(student)
    .values({
      tenantId,
      schoolId: parsed.schoolId,
      fullName: parsed.studentFullName,
      grade: parsed.grade,
      handoverPolicy: parsed.handoverPolicy,
      enrollmentStart: parsed.enrollmentStart,
      usesMorning: parsed.usesMorning,
      usesEvening: parsed.usesEvening,
    })
    .returning({ id: student.id });
  if (!created) throw new HttpError(500, 'insert_failed', 'Öğrenci kaydedilemedi');
  const identityId = await resolveGuardianIdentity(tx, {
    phone: parsed.guardianPhone,
    fullName: parsed.guardianFullName,
    reuseIdentityId: parsed.reuseIdentityId ?? classified.existingIdentityId ?? undefined,
  });
  const membershipId = await attachMembership(tx, tenantId, identityId, 'GUARDIAN');
  await upsertGuardianLink(tx, {
    tenantId,
    studentId: created.id,
    membershipId,
    relation: parsed.relation,
    isPrimary: parsed.isPrimary,
  });
  await tx
    .update(importBatchRow)
    .set({
      status: 'COMMITTED',
      errorCode: null,
      studentId: created.id,
      identityId,
      membershipId,
      committedAt: new Date(),
    })
    .where(eq(importBatchRow.id, row.id));
}

export async function upsertGuardianLink(
  tx: Database,
  input: {
    tenantId: string;
    studentId: string;
    membershipId: string;
    relation: string;
    isPrimary: boolean;
    canReceiveChild?: boolean;
    canAuthorizeTempAddress?: boolean;
    canSubmitException?: boolean;
    notifyAm?: boolean;
    notifyPm?: boolean;
  },
): Promise<void> {
  const [existing] = await tx
    .select({
      id: studentGuardian.id,
      status: studentGuardian.status,
    })
    .from(studentGuardian)
    .where(
      and(
        eq(studentGuardian.tenantId, input.tenantId),
        eq(studentGuardian.studentId, input.studentId),
        eq(studentGuardian.guardianMembershipId, input.membershipId),
      ),
    );
  if (existing?.status === 'REVOKED') {
    throw conflict('guardian_revoked', 'İptal edilmiş veli ilişkisi sessizce açılmaz');
  }
  if (!existing) {
    await tx.insert(studentGuardian).values({
      tenantId: input.tenantId,
      studentId: input.studentId,
      guardianMembershipId: input.membershipId,
      relation: input.relation,
      isPrimary: input.isPrimary,
      canReceiveChild: input.canReceiveChild ?? true,
      canAuthorizeTempAddress: input.canAuthorizeTempAddress ?? false,
      canSubmitException: input.canSubmitException ?? true,
      notifyAm: input.notifyAm ?? true,
      notifyPm: input.notifyPm ?? true,
      status: 'ACTIVE',
    });
    return;
  }
  await tx
    .update(studentGuardian)
    .set({
      relation: input.relation,
      isPrimary: input.isPrimary,
      canReceiveChild: input.canReceiveChild ?? true,
      canAuthorizeTempAddress: input.canAuthorizeTempAddress ?? false,
      canSubmitException: input.canSubmitException ?? true,
      notifyAm: input.notifyAm ?? true,
      notifyPm: input.notifyPm ?? true,
    })
    .where(and(eq(studentGuardian.id, existing.id), eq(studentGuardian.tenantId, input.tenantId)));
}

async function loadBatchOrThrow(
  tx: Database,
  tenantId: string,
  batchId: string,
): Promise<ImportBatchView> {
  const batch = await loadBatch(tx, tenantId, batchId);
  if (!batch) throw new HttpError(500, 'import_missing', 'İçe aktarma okunamadı');
  return batch;
}

async function loadBatch(
  tx: Database,
  tenantId: string,
  batchId: string,
): Promise<ImportBatchView | null> {
  const [batch] = await tx
    .select()
    .from(importBatch)
    .where(and(eq(importBatch.id, batchId), eq(importBatch.tenantId, tenantId)));
  if (!batch) return null;
  const rows = await tx
    .select()
    .from(importBatchRow)
    .where(and(eq(importBatchRow.batchId, batchId), eq(importBatchRow.tenantId, tenantId)));
  const views: ImportRowView[] = rows.map((row) => {
    const parsed = asImportRow(row.raw);
    return {
      rowNo: row.rowNo,
      status: row.status,
      errorCode: row.errorCode,
      existingIdentityId: row.existingIdentityId,
      existingFullName: row.existingFullName,
      studentId: row.studentId,
      identityId: row.identityId,
      membershipId: row.membershipId,
      guardianPhone: parsed?.guardianPhone ?? phoneOf(row.raw),
      studentFullName: parsed?.studentFullName ?? null,
    };
  });
  const phones = new Set(
    views
      .filter((row) => row.status === 'READY' || row.status === 'COMMITTED')
      .map((row) => row.guardianPhone)
      .filter((phone): phone is string => Boolean(phone)),
  );
  const memberships = [
    ...new Set(views.map((row) => row.membershipId).filter((id): id is string => Boolean(id))),
  ];
  let pendingInvites = 0;
  if (memberships.length > 0) {
    const invites = await tx
      .select({ membershipId: guardianInvite.membershipId })
      .from(guardianInvite)
      .where(and(eq(guardianInvite.tenantId, tenantId), eq(guardianInvite.status, 'PENDING')));
    const pending = new Set(invites.map((item) => item.membershipId));
    pendingInvites = memberships.filter((id) => pending.has(id)).length;
  }
  return {
    id: batch.id,
    fileName: batch.fileName,
    fileHash: batch.fileHash,
    summary: {
      total: views.length,
      ready: views.filter((row) => row.status === 'READY').length,
      needsFix: views.filter((row) => row.status === 'NEEDS_FIX').length,
      addressUnverified: views.filter((row) => row.status === 'ADDRESS_UNVERIFIED').length,
      committed: views.filter((row) => row.status === 'COMMITTED').length,
      failed: views.filter((row) => row.status === 'FAILED').length,
      uniqueGuardianPhones: phones.size,
      pendingInvites,
    },
    rows: views.sort((a, b) => a.rowNo - b.rowNo),
  };
}

async function insertInvite(
  tx: Database,
  options: OnboardingOptions,
  tenantId: string,
  actorMembershipId: string,
  membershipId: string,
  token: string,
): Promise<GuardianInviteView> {
  const [membership] = await tx
    .select({
      id: tenantMembership.id,
      identityId: tenantMembership.identityId,
    })
    .from(tenantMembership)
    .where(and(eq(tenantMembership.id, membershipId), eq(tenantMembership.tenantId, tenantId)));
  if (!membership) throw notFound('Üyelik bulunamadı');
  const [guardianRole] = await tx
    .select({ role: membershipRole.role })
    .from(membershipRole)
    .where(
      and(
        eq(membershipRole.tenantId, tenantId),
        eq(membershipRole.membershipId, membershipId),
        eq(membershipRole.role, 'GUARDIAN'),
      ),
    );
  if (!guardianRole) {
    throw conflict('invite_not_guardian', 'Davet yalnız veli üyeliğine açılır');
  }
  await tx
    .update(guardianInvite)
    .set({ status: 'REVOKED' })
    .where(
      and(
        eq(guardianInvite.tenantId, tenantId),
        eq(guardianInvite.membershipId, membershipId),
        eq(guardianInvite.status, 'PENDING'),
      ),
    );
  const [created] = await tx
    .insert(guardianInvite)
    .values({
      tenantId,
      identityId: membership.identityId,
      membershipId,
      tokenHash: hashInviteToken(token, options.invitePepper),
      status: 'PENDING',
      expiresAt: inviteExpiresAt(),
      createdByMembershipId: actorMembershipId,
    })
    .returning({ id: guardianInvite.id });
  if (!created) throw new HttpError(500, 'insert_failed', 'Davet oluşturulamadı');
  return toInviteView(tx, options, tenantId, created.id, token);
}

async function toInviteView(
  tx: Database,
  options: OnboardingOptions,
  tenantId: string,
  inviteId: string,
  token: string | null,
): Promise<GuardianInviteView> {
  const [invite] = await tx
    .select()
    .from(guardianInvite)
    .where(and(eq(guardianInvite.id, inviteId), eq(guardianInvite.tenantId, tenantId)));
  if (!invite) throw notFound('Davet bulunamadı');
  const [sms] = await tx
    .select({ status: inviteSms.status })
    .from(inviteSms)
    .where(and(eq(inviteSms.inviteId, inviteId), eq(inviteSms.tenantId, tenantId)))
    .orderBy(desc(inviteSms.createdAt))
    .limit(1);
  return {
    id: invite.id,
    membershipId: invite.membershipId,
    identityId: invite.identityId,
    status: invite.status,
    expiresAt: invite.expiresAt.toISOString(),
    smsStatus: sms?.status ?? null,
    inviteUrl: token ? invitePublicUrl(options.publicAppUrl, token) : null,
    token: options.revealInviteSecrets ? token : null,
  };
}

interface InviteLookup {
  id: string;
  tenantId: string;
  tenantName: string;
  identityId: string;
  membershipId: string;
  status: PublicInviteView['status'];
  phone: string;
  fullName: string;
}

async function lookupInvite(
  db: Database,
  pepper: string,
  token: string,
): Promise<InviteLookup | null> {
  const hash = hashInviteToken(token, pepper).toString('hex');
  const result: unknown = await db.execute(
    sql`select find_invite_by_token_hash(decode(${hash}, 'hex')) as found`,
  );
  const row = firstRow(result);
  const found = jsonObject(row?.['found']);
  if (!found) return null;
  const status = found['status'];
  if (
    status !== 'PENDING' &&
    status !== 'USED' &&
    status !== 'EXPIRED' &&
    status !== 'REVOKED'
  ) {
    return null;
  }
  return {
    id: asText(found['id']),
    tenantId: asText(found['tenantId']),
    tenantName: asText(found['tenantName']),
    identityId: asText(found['identityId']),
    membershipId: asText(found['membershipId']),
    status,
    phone: asText(found['phone']),
    fullName: asText(found['fullName']),
  };
}
