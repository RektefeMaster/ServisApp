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
import { and, asc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import type postgres from 'postgres';
import { composeNotification } from '../notify/copy.js';
import { planNotificationDelivery } from '../notify/delivery-plan.js';
import type { PushSender, SmsSender } from '../notify/senders.js';

export const OUTBOX_QUEUE = 'notify.outbox';

/**
 * Dış sağlayıcıya yapılan HTTP çağrısı DB transaction'ının DIŞINDA olur.
 *
 * Önceki hâlde satırlar `for update skip locked` ile kilitlenir, sonra aynı
 * transaction kapanmadan SMS/push sağlayıcısına gidilirdi. Sağlayıcı yavaşladığı
 * sürece transaction açık, satır kilitli ve bağlantı işgal kalıyordu. Artık üç
 * evre var: kısa "claim" transaction'ı, transaction'sız gönderim, kısa
 * "sonuçlandır" transaction'ı. Çöken worker'ın claim'i CLAIM_TIMEOUT_MS sonra
 * serbest kalır.
 */
const CLAIM_TIMEOUT_MS = 5 * 60_000;
const CLAIM_BATCH = 50;

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

type SendOutcome = 'sent' | 'failed' | 'retry';

interface NotificationJob {
  id: string;
  kind: 'push' | 'sms';
  title: string;
  body: string;
  type: string;
  tripId: string;
  studentId: string;
  tokens: string[];
  phone: string;
  /** PUSH kaydı SMS'e düştüyse kanal kolonu da güncellenir. */
  channelBecomesSms: boolean;
}

interface InviteJob {
  id: string;
  phone: string;
  body: string;
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
    const context = { tenantId: tenant.id, membershipId: null, role: 'SYSTEM' } as const;

    // 1) Kısa transaction: üstlen ve gönderim için gereken her şeyi topla.
    const claimed = await withTenant(db, context, async (tx) => ({
      notifications: await claimNotifications(tx, tenant.id, options, now),
      invites: await claimInviteSms(tx, tenant.id, options, now),
    }));
    failed += claimed.notifications.failed + claimed.invites.failed;

    // 2) Transaction yok: sağlayıcı ne kadar yavaş olursa olsun DB beklemez.
    const noteOutcomes = new Map<string, SendOutcome>();
    for (const job of claimed.notifications.jobs) {
      noteOutcomes.set(job.id, await sendNotification(job, options));
    }
    const inviteOutcomes = new Map<string, SendOutcome>();
    for (const job of claimed.invites.jobs) {
      inviteOutcomes.set(job.id, await sendInvite(job, options));
    }

    // 3) Kısa transaction: sonucu yaz.
    if (noteOutcomes.size > 0 || inviteOutcomes.size > 0) {
      await withTenant(db, context, async (tx) => {
        await settleNotifications(tx, tenant.id, claimed.notifications.jobs, noteOutcomes);
        await settleInvites(tx, tenant.id, inviteOutcomes);
      });
    }

    for (const outcome of noteOutcomes.values()) {
      if (outcome === 'sent') notifications += 1;
      else if (outcome === 'failed') failed += 1;
    }
    for (const outcome of inviteOutcomes.values()) {
      if (outcome === 'sent') inviteCount += 1;
      else if (outcome === 'failed') failed += 1;
    }
  }

  return {
    tenants: tenants.length,
    notifications,
    inviteSms: inviteCount,
    failed,
  };
}

async function claimNotifications(
  tx: Database,
  tenantId: string,
  options: OutboxOptions,
  now: Date,
): Promise<{ jobs: NotificationJob[]; failed: number }> {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const due = await tx
    .select({
      id: notification.id,
      recipientMembershipId: notification.recipientMembershipId,
      recipientPhone: notification.recipientPhone,
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
        or(isNull(notification.claimedAt), lt(notification.claimedAt, staleBefore)),
      ),
    )
    .orderBy(asc(notification.createdAt))
    .for('update', { skipLocked: true })
    .limit(CLAIM_BATCH);

  const jobs: NotificationJob[] = [];
  const claimedIds: string[] = [];
  const failedIds: string[] = [];

  // Satır başına öğrenci adı / push jetonu / telefon sorgusu, 50'lik partide
  // 150 gidiş-dönüş demekti — üstelik her 15 saniyede bir, her kiracı için.
  // Parti bir kez, toplu okunur.
  const names = await loadStudentNames(tx, tenantId, distinct(due.map((row) => row.studentId)));
  const memberships = distinct(due.map((row) => row.recipientMembershipId));
  const tokensByMembership = await loadPushTokens(tx, tenantId, memberships);
  const phoneByMembership = await loadMembershipPhones(tx, tenantId, memberships);

  for (const row of due) {
    const studentName = (row.studentId ? names.get(row.studentId) : null) ?? 'Çocuğun';
    const copy = composeNotification({ type: row.type, studentName });
    // Telefona adresli bildirimin üyeliği yoktur: push hedefi de yoktur, SMS'tir.
    const tokens = row.recipientMembershipId
      ? (tokensByMembership.get(row.recipientMembershipId) ?? [])
      : [];
    const plan = planNotificationDelivery({
      channel: row.channel,
      hasPushToken: tokens.length > 0,
      smsAvailable: options.sms !== null,
      ageMs: now.getTime() - row.createdAt.getTime(),
    });
    if (plan === 'skip') continue;
    if (plan === 'fail') {
      failedIds.push(row.id);
      continue;
    }
    if (plan === 'sms') {
      if (!options.sms) continue;
      const body =
        row.type === 'DELIVERY_OTP'
          ? await loadOtpSmsBody(tx, tenantId, row.refId, options.encryptionKey, studentName)
          : copy.body;
      const phone =
        row.recipientPhone ??
        (row.recipientMembershipId
          ? (phoneByMembership.get(row.recipientMembershipId) ?? null)
          : null);
      if (!body || !phone) {
        failedIds.push(row.id);
        continue;
      }
      jobs.push({
        id: row.id,
        kind: 'sms',
        title: copy.title,
        body,
        type: row.type,
        tripId: row.tripId ?? '',
        studentId: row.studentId ?? '',
        tokens: [],
        phone,
        channelBecomesSms: row.channel === 'PUSH',
      });
      claimedIds.push(row.id);
      continue;
    }
    jobs.push({
      id: row.id,
      kind: 'push',
      title: copy.title,
      body: copy.body,
      type: row.type,
      tripId: row.tripId ?? '',
      studentId: row.studentId ?? '',
      tokens,
      phone: '',
      channelBecomesSms: false,
    });
    claimedIds.push(row.id);
  }

  if (failedIds.length > 0) {
    await tx
      .update(notification)
      .set({ status: 'FAILED', sentAt: null, claimedAt: null })
      .where(and(eq(notification.tenantId, tenantId), inArray(notification.id, failedIds)));
  }
  if (claimedIds.length > 0) {
    await tx
      .update(notification)
      .set({ claimedAt: now })
      .where(and(eq(notification.tenantId, tenantId), inArray(notification.id, claimedIds)));
  }
  return { jobs, failed: failedIds.length };
}

async function claimInviteSms(
  tx: Database,
  tenantId: string,
  options: OutboxOptions,
  now: Date,
): Promise<{ jobs: InviteJob[]; failed: number }> {
  if (!options.sms) return { jobs: [], failed: 0 };
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  // Davet sahibinin telefonu tek JOIN ile gelir; satır başına iki sorgu yoktu.
  const due = await tx
    .select({
      id: inviteSms.id,
      bodyCiphertext: inviteSms.bodyCiphertext,
      phone: identity.phoneE164,
    })
    .from(inviteSms)
    .innerJoin(
      guardianInvite,
      and(
        eq(guardianInvite.id, inviteSms.inviteId),
        eq(guardianInvite.tenantId, inviteSms.tenantId),
      ),
    )
    .innerJoin(identity, eq(identity.id, guardianInvite.identityId))
    .where(
      and(
        eq(inviteSms.tenantId, tenantId),
        eq(inviteSms.status, 'QUEUED'),
        or(isNull(inviteSms.claimedAt), lt(inviteSms.claimedAt, staleBefore)),
      ),
    )
    .for('update', { of: inviteSms, skipLocked: true })
    .limit(CLAIM_BATCH);

  const jobs: InviteJob[] = [];
  const claimedIds: string[] = [];
  const failedIds: string[] = [];

  for (const row of due) {
    const packed = asBuffer(row.bodyCiphertext);
    if (!packed || !row.phone) {
      failedIds.push(row.id);
      continue;
    }
    let url: string;
    try {
      url = decryptDeliveryOtp(packed, options.encryptionKey);
    } catch {
      failedIds.push(row.id);
      continue;
    }
    jobs.push({ id: row.id, phone: row.phone, body: `ServisApp veli daveti: ${url}` });
    claimedIds.push(row.id);
  }

  if (failedIds.length > 0) {
    await tx
      .update(inviteSms)
      .set({ status: 'FAILED', provider: 'none', updatedAt: now, claimedAt: null })
      .where(and(eq(inviteSms.tenantId, tenantId), inArray(inviteSms.id, failedIds)));
  }
  if (claimedIds.length > 0) {
    await tx
      .update(inviteSms)
      .set({ claimedAt: now })
      .where(and(eq(inviteSms.tenantId, tenantId), inArray(inviteSms.id, claimedIds)));
  }
  return { jobs, failed: failedIds.length };
}

async function sendNotification(
  job: NotificationJob,
  options: OutboxOptions,
): Promise<SendOutcome> {
  if (job.kind === 'sms') {
    if (!options.sms) return 'retry';
    const sent = await options.sms.send({ toE164: job.phone, body: job.body });
    if (sent.ok) return 'sent';
    return sent.retry ? 'retry' : 'failed';
  }
  let anyOk = false;
  let retry = false;
  for (const to of job.tokens) {
    const sent = await options.push.send({
      to,
      title: job.title,
      body: job.body,
      data: { type: job.type, tripId: job.tripId, studentId: job.studentId },
    });
    if (sent.ok) anyOk = true;
    else if (sent.retry) retry = true;
  }
  if (anyOk) return 'sent';
  return retry ? 'retry' : 'failed';
}

async function sendInvite(job: InviteJob, options: OutboxOptions): Promise<SendOutcome> {
  if (!options.sms) return 'retry';
  const sent = await options.sms.send({ toE164: job.phone, body: job.body });
  if (sent.ok) return 'sent';
  return sent.retry ? 'retry' : 'failed';
}

async function settleNotifications(
  tx: Database,
  tenantId: string,
  jobs: readonly NotificationJob[],
  outcomes: ReadonlyMap<string, SendOutcome>,
): Promise<void> {
  const sentAt = new Date();
  /**
   * Sonuç yalnız HÂLÂ QUEUED olan satıra yazılır.
   *
   * Gönderim transaction dışında olduğu için bu aralıkta satır iptal edilmiş
   * olabilir (şoför bindiyi geri aldı). Şartsız `status='SENT'` yazmak iptal
   * edilmiş satırı diriltiyor ve geri alma akışının kaydını yalanlıyordu.
   */
  const stillQueued = eq(notification.status, 'QUEUED');
  const smsFallback = jobs.filter(
    (job) => job.channelBecomesSms && outcomes.get(job.id) === 'sent',
  );
  const sent = jobs.filter((job) => outcomes.get(job.id) === 'sent' && !job.channelBecomesSms);
  const failed = jobs.filter((job) => outcomes.get(job.id) === 'failed');
  const retry = jobs.filter((job) => outcomes.get(job.id) === 'retry');

  if (smsFallback.length > 0) {
    await tx
      .update(notification)
      .set({ status: 'SENT', sentAt, channel: 'SMS', claimedAt: null })
      .where(
        and(
          eq(notification.tenantId, tenantId),
          stillQueued,
          inArray(
            notification.id,
            smsFallback.map((job) => job.id),
          ),
        ),
      );
  }
  if (sent.length > 0) {
    await tx
      .update(notification)
      .set({ status: 'SENT', sentAt, claimedAt: null })
      .where(
        and(
          eq(notification.tenantId, tenantId),
          stillQueued,
          inArray(
            notification.id,
            sent.map((job) => job.id),
          ),
        ),
      );
  }
  if (failed.length > 0) {
    await tx
      .update(notification)
      .set({ status: 'FAILED', sentAt: null, claimedAt: null })
      .where(
        and(
          eq(notification.tenantId, tenantId),
          stillQueued,
          inArray(
            notification.id,
            failed.map((job) => job.id),
          ),
        ),
      );
  }
  if (retry.length > 0) {
    // QUEUED kalır, claim serbest bırakılır: bir sonraki tur yeniden dener.
    await tx
      .update(notification)
      .set({ claimedAt: null })
      .where(
        and(
          eq(notification.tenantId, tenantId),
          inArray(
            notification.id,
            retry.map((job) => job.id),
          ),
        ),
      );
  }
}

async function settleInvites(
  tx: Database,
  tenantId: string,
  outcomes: ReadonlyMap<string, SendOutcome>,
): Promise<void> {
  const now = new Date();
  const byOutcome = (want: SendOutcome): string[] =>
    [...outcomes.entries()].filter(([, outcome]) => outcome === want).map(([id]) => id);

  const sent = byOutcome('sent');
  if (sent.length > 0) {
    await tx
      .update(inviteSms)
      .set({ status: 'SENT', provider: 'netgsm', updatedAt: now, claimedAt: null })
      .where(and(eq(inviteSms.tenantId, tenantId), inArray(inviteSms.id, sent)));
  }
  const failed = byOutcome('failed');
  if (failed.length > 0) {
    await tx
      .update(inviteSms)
      .set({ status: 'FAILED', provider: 'netgsm', updatedAt: now, claimedAt: null })
      .where(and(eq(inviteSms.tenantId, tenantId), inArray(inviteSms.id, failed)));
  }
  const retry = byOutcome('retry');
  if (retry.length > 0) {
    await tx
      .update(inviteSms)
      .set({ claimedAt: null })
      .where(and(eq(inviteSms.tenantId, tenantId), inArray(inviteSms.id, retry)));
  }
}

function distinct(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))];
}

async function loadPushTokens(
  tx: Database,
  tenantId: string,
  membershipIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byMembership = new Map<string, string[]>();
  if (membershipIds.length === 0) return byMembership;
  const rows = await tx
    .select({ membershipId: device.membershipId, pushToken: device.pushToken })
    .from(device)
    .where(
      and(
        eq(device.tenantId, tenantId),
        inArray(device.membershipId, [...membershipIds]),
        isNull(device.revokedAt),
      ),
    );
  for (const row of rows) {
    if (typeof row.pushToken !== 'string' || row.pushToken.length <= 8) continue;
    const list = byMembership.get(row.membershipId) ?? [];
    list.push(row.pushToken);
    byMembership.set(row.membershipId, list);
  }
  return byMembership;
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
    .select({
      ciphertext: deliveryOverride.otpCiphertext,
      receiverName: deliveryOverride.receiverName,
    })
    .from(deliveryOverride)
    .where(and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)));
  const packed = asBuffer(row?.ciphertext);
  if (!packed) return null;
  try {
    const code = decryptDeliveryOtp(packed, encryptionKey);
    // Mesaj kodu alacak kişiye yazılır: kapıda şoföre söyleyeceği şey budur.
    const who = row?.receiverName?.trim() ?? '';
    const greeting = who.length > 0 ? `${who}, ` : '';
    return `${greeting}${studentName} bugün size teslim edilecek. Şoföre söyleyeceğiniz ServisApp kodu: ${code}`;
  } catch {
    return null;
  }
}

async function loadStudentNames(
  tx: Database,
  tenantId: string,
  studentIds: readonly string[],
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: student.id, fullName: student.fullName })
    .from(student)
    .where(and(eq(student.tenantId, tenantId), inArray(student.id, [...studentIds])));
  return new Map(rows.map((row) => [row.id, row.fullName]));
}

async function loadMembershipPhones(
  tx: Database,
  tenantId: string,
  membershipIds: readonly string[],
): Promise<Map<string, string>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await tx
    .select({ membershipId: tenantMembership.id, phone: identity.phoneE164 })
    .from(tenantMembership)
    .innerJoin(identity, eq(identity.id, tenantMembership.identityId))
    .where(
      and(
        eq(tenantMembership.tenantId, tenantId),
        inArray(tenantMembership.id, [...membershipIds]),
      ),
    );
  return new Map(rows.map((row) => [row.membershipId, row.phone]));
}
