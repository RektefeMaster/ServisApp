import {
  createDbFromSql,
  deliveryOverride,
  device,
  guardianInvite,
  identity,
  inviteSms,
  notification,
  student,
  tenantMembership,
  withTenant,
  type Database,
} from '@servisapp/db';
import { decryptDeliveryOtp } from '../crypto/delivery-otp.js';
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import type postgres from 'postgres';
import { composeNotification } from '../notify/copy.js';
import { planNotificationDelivery } from '../notify/delivery-plan.js';
import type { PushSender, SmsSender } from '../notify/senders.js';

export const OUTBOX_QUEUE = 'notify.outbox';

export interface OutboxOptions {
  encryptionKey: string;
  push: PushSender;
  sms: SmsSender | null;
  now?: Date;
}

export interface OutboxResult {
  tenants: number;
  notifications: number;
  inviteSms: number;
  failed: number;
}

function asBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

export async function runOutboxJob(
  sql: postgres.Sql,
  options: OutboxOptions,
  db: Database = createDbFromSql(sql),
): Promise<OutboxResult> {
  const tenants = await sql<{ id: string }[]>`
    select id from list_tenants_for_jobs()
  `;
  const now = options.now ?? new Date();
  let notifications = 0;
  let inviteCount = 0;
  let failed = 0;
  for (const tenant of tenants) {
    const processed = await withTenant(
      db,
      { tenantId: tenant.id, membershipId: null, role: 'SYSTEM' },
      async (tx) => {
        const notes = await processDueNotifications(tx, tenant.id, options, now);
        const invites = await processDueInviteSms(tx, tenant.id, options);
        return {
          notes: notes.notes,
          invites: invites.invites,
          failed: notes.failed + invites.failed,
        };
      },
    );
    notifications += processed.notes;
    inviteCount += processed.invites;
    failed += processed.failed;
  }
  return {
    tenants: tenants.length,
    notifications,
    inviteSms: inviteCount,
    failed,
  };
}

async function processDueNotifications(
  tx: Database,
  tenantId: string,
  options: OutboxOptions,
  now: Date,
): Promise<{ notes: number; invites: number; failed: number }> {
  const due = await tx
    .select({
      id: notification.id,
      recipientMembershipId: notification.recipientMembershipId,
      channel: notification.channel,
      type: notification.type,
      tripId: notification.tripId,
      studentId: notification.studentId,
      refId: notification.refId,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(
      and(
        eq(notification.tenantId, tenantId),
        eq(notification.status, 'QUEUED'),
        or(isNull(notification.holdUntil), lte(notification.holdUntil, now)),
      ),
    )
    .orderBy(asc(notification.createdAt))
    .for('update', { skipLocked: true })
    .limit(50);

  let notes = 0;
  let failed = 0;
  for (const row of due) {
    const outcome = await deliverNotification(tx, tenantId, row, options, now);
    if (outcome === 'sent') notes += 1;
    else if (outcome === 'failed') failed += 1;
  }
  return { notes, invites: 0, failed };
}

async function processDueInviteSms(
  tx: Database,
  tenantId: string,
  options: OutboxOptions,
): Promise<{ notes: number; invites: number; failed: number }> {
  if (!options.sms) return { notes: 0, invites: 0, failed: 0 };
  const due = await tx
    .select({
      id: inviteSms.id,
      inviteId: inviteSms.inviteId,
      bodyCiphertext: inviteSms.bodyCiphertext,
    })
    .from(inviteSms)
    .where(and(eq(inviteSms.tenantId, tenantId), eq(inviteSms.status, 'QUEUED')))
    .for('update', { skipLocked: true })
    .limit(50);

  let invites = 0;
  let failed = 0;
  for (const row of due) {
    const packed = asBuffer(row.bodyCiphertext);
    if (!packed) {
      await markInviteSms(tx, tenantId, row.id, 'FAILED', 'none');
      failed += 1;
      continue;
    }
    let url: string;
    try {
      url = decryptDeliveryOtp(packed, options.encryptionKey);
    } catch {
      await markInviteSms(tx, tenantId, row.id, 'FAILED', 'none');
      failed += 1;
      continue;
    }
    const [invite] = await tx
      .select({ identityId: guardianInvite.identityId })
      .from(guardianInvite)
      .where(and(eq(guardianInvite.id, row.inviteId), eq(guardianInvite.tenantId, tenantId)));
    if (!invite) {
      await markInviteSms(tx, tenantId, row.id, 'FAILED', 'none');
      failed += 1;
      continue;
    }
    const [person] = await tx
      .select({ phone: identity.phoneE164 })
      .from(identity)
      .where(eq(identity.id, invite.identityId));
    if (!person?.phone) {
      await markInviteSms(tx, tenantId, row.id, 'FAILED', 'none');
      failed += 1;
      continue;
    }
    const sent = await options.sms.send({
      toE164: person.phone,
      body: `ServisApp veli daveti: ${url}`,
    });
    if (sent.ok) {
      await markInviteSms(tx, tenantId, row.id, 'SENT', 'netgsm');
      invites += 1;
      continue;
    }
    if (sent.retry) continue;
    await markInviteSms(tx, tenantId, row.id, 'FAILED', 'netgsm');
    failed += 1;
  }
  return { notes: 0, invites, failed };
}

async function deliverNotification(
  tx: Database,
  tenantId: string,
  row: {
    id: string;
    recipientMembershipId: string;
    channel: 'PUSH' | 'SMS';
    type: string;
    tripId: string | null;
    studentId: string | null;
    refId: string | null;
    createdAt: Date;
  },
  options: OutboxOptions,
  now: Date,
): Promise<'sent' | 'failed' | 'skipped'> {
  const studentName = await loadStudentName(tx, tenantId, row.studentId);
  const copy = composeNotification({ type: row.type, studentName });
  const tokens = await loadPushTokens(tx, tenantId, row.recipientMembershipId);
  const plan = planNotificationDelivery({
    channel: row.channel,
    hasPushToken: tokens.length > 0,
    smsAvailable: options.sms !== null,
    ageMs: now.getTime() - row.createdAt.getTime(),
  });
  switch (plan) {
    case 'skip':
      return 'skipped';
    case 'fail':
      await markNotification(tx, tenantId, row.id, 'FAILED');
      return 'failed';
    case 'sms': {
      if (!options.sms) return 'skipped';
      const body =
        row.type === 'DELIVERY_OTP'
          ? await loadOtpSmsBody(tx, tenantId, row.refId, options.encryptionKey, studentName)
          : copy.body;
      if (!body) {
        await markNotification(tx, tenantId, row.id, 'FAILED');
        return 'failed';
      }
      const phone = await loadMembershipPhone(tx, tenantId, row.recipientMembershipId);
      if (!phone) {
        await markNotification(tx, tenantId, row.id, 'FAILED');
        return 'failed';
      }
      const sent = await options.sms.send({ toE164: phone, body });
      if (sent.ok) {
        await markNotification(tx, tenantId, row.id, 'SENT', row.channel === 'PUSH' ? 'SMS' : undefined);
        return 'sent';
      }
      if (sent.retry) return 'skipped';
      await markNotification(tx, tenantId, row.id, 'FAILED');
      return 'failed';
    }
    case 'push': {
      let anyOk = false;
      let retry = false;
      for (const to of tokens) {
        const sent = await options.push.send({
          to,
          title: copy.title,
          body: copy.body,
          data: {
            type: row.type,
            tripId: row.tripId ?? '',
            studentId: row.studentId ?? '',
          },
        });
        if (sent.ok) anyOk = true;
        else if (sent.retry) retry = true;
      }
      if (anyOk) {
        await markNotification(tx, tenantId, row.id, 'SENT');
        return 'sent';
      }
      if (retry) return 'skipped';
      await markNotification(tx, tenantId, row.id, 'FAILED');
      return 'failed';
    }
    default: {
      const unexpected: never = plan;
      return unexpected;
    }
  }
}

async function loadPushTokens(
  tx: Database,
  tenantId: string,
  membershipId: string,
): Promise<string[]> {
  const tokens = await tx
    .select({ pushToken: device.pushToken })
    .from(device)
    .where(
      and(
        eq(device.tenantId, tenantId),
        eq(device.membershipId, membershipId),
        isNull(device.revokedAt),
      ),
    );
  return tokens
    .map((item) => item.pushToken)
    .filter((token): token is string => typeof token === 'string' && token.length > 8);
}

async function loadOtpSmsBody(
  tx: Database,
  tenantId: string,
  overrideId: string | null,
  encryptionKey: string,
  studentName: string,
): Promise<string | null> {
  if (!overrideId) return null;
  const [row] = await tx
    .select({ ciphertext: deliveryOverride.otpCiphertext })
    .from(deliveryOverride)
    .where(and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)));
  const packed = asBuffer(row?.ciphertext);
  if (!packed) return null;
  try {
    const code = decryptDeliveryOtp(packed, encryptionKey);
    return `${studentName} teslim kodu: ${code}`;
  } catch {
    return null;
  }
}

async function loadStudentName(
  tx: Database,
  tenantId: string,
  studentId: string | null,
): Promise<string> {
  if (!studentId) return 'Çocuğun';
  const [row] = await tx
    .select({ fullName: student.fullName })
    .from(student)
    .where(and(eq(student.id, studentId), eq(student.tenantId, tenantId)));
  return row?.fullName ?? 'Çocuğun';
}

async function loadMembershipPhone(
  tx: Database,
  tenantId: string,
  membershipId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ phone: identity.phoneE164 })
    .from(tenantMembership)
    .innerJoin(identity, eq(identity.id, tenantMembership.identityId))
    .where(and(eq(tenantMembership.id, membershipId), eq(tenantMembership.tenantId, tenantId)));
  return row?.phone ?? null;
}

async function markNotification(
  tx: Database,
  tenantId: string,
  id: string,
  status: 'SENT' | 'FAILED',
  channel?: 'PUSH' | 'SMS',
): Promise<void> {
  await tx
    .update(notification)
    .set({
      status,
      sentAt: status === 'SENT' ? new Date() : null,
      ...(channel ? { channel } : {}),
    })
    .where(and(eq(notification.id, id), eq(notification.tenantId, tenantId)));
}

async function markInviteSms(
  tx: Database,
  tenantId: string,
  id: string,
  status: 'SENT' | 'FAILED',
  provider: string,
): Promise<void> {
  await tx
    .update(inviteSms)
    .set({
      status,
      provider,
      updatedAt: new Date(),
    })
    .where(and(eq(inviteSms.id, id), eq(inviteSms.tenantId, tenantId)));
}
