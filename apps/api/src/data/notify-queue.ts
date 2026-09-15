import { notification, studentGuardian, tenantMembership, type Database } from '@servisapp/db';
import { and, eq, inArray } from 'drizzle-orm';

export async function queueGuardianNotifications(
  tx: Database,
  input: {
    tenantId: string;
    studentId: string;
    type: string;
    dedupe: string;
    channel?: 'PUSH' | 'SMS';
    tripId?: string | null;
    holdUntil?: Date | null;
    sourceCommandId?: string | null;
    refId?: string | null;
    /** OTP/SMS: yalnız farklı teslim yetkisi olan veliler. */
    requireAuthorizeTempAddress?: boolean;
  },
): Promise<void> {
  const channel = input.channel ?? 'PUSH';
  const rows = await tx
    .select({
      membershipId: studentGuardian.guardianMembershipId,
      canAuthorizeTempAddress: studentGuardian.canAuthorizeTempAddress,
    })
    .from(studentGuardian)
    .innerJoin(
      tenantMembership,
      and(
        eq(tenantMembership.id, studentGuardian.guardianMembershipId),
        eq(tenantMembership.tenantId, input.tenantId),
      ),
    )
    .where(
      and(
        eq(studentGuardian.tenantId, input.tenantId),
        eq(studentGuardian.studentId, input.studentId),
        eq(studentGuardian.status, 'ACTIVE'),
        // İlişki açık olsa da üyeliği kapatılmış kişiye bildirim gitmez.
        inArray(tenantMembership.status, ['ACTIVE', 'INVITED']),
      ),
    );
  for (const row of rows) {
    if (input.requireAuthorizeTempAddress && !row.canAuthorizeTempAddress) continue;
    await tx
      .insert(notification)
      .values({
        tenantId: input.tenantId,
        recipientMembershipId: row.membershipId,
        channel,
        type: input.type,
        studentId: input.studentId,
        tripId: input.tripId ?? null,
        holdUntil: input.holdUntil ?? null,
        sourceCommandId: input.sourceCommandId ?? null,
        refId: input.refId ?? null,
        dedupeKey: `${input.dedupe}:${channel}:${row.membershipId}`,
        status: 'QUEUED',
      })
      // Yineleme SESSİZCE atlanır. Hatayı JS'te yakalayıp yutmak yetmez:
      // PostgreSQL'de bir ifade patladığında transaction'ın tamamı iptal olur
      // ve sonraki her sorgu "current transaction is aborted" der. Tek doğru
      // yol, veritabanının hiç hata üretmemesidir.
      .onConflictDoNothing({ target: [notification.tenantId, notification.dedupeKey] });
  }
}

/**
 * Sisteme kayıtlı olmayan bir telefona SMS kuyruğa alır.
 *
 * Farklı teslimatta teslim kodu, çocuğu alacak kişinin numarasına gider: kodun
 * velide olması yalnız "yetki" gösterir, kapıda çocuğu alan kişinin kendisinin
 * doğrulanması gerekir. Alıcıyı yine kayıtlı veli belirler.
 */
export async function queuePhoneNotification(
  tx: Database,
  input: {
    tenantId: string;
    studentId: string;
    phone: string;
    type: string;
    dedupe: string;
    tripId?: string | null;
    refId?: string | null;
  },
): Promise<void> {
  await tx
    .insert(notification)
    .values({
      tenantId: input.tenantId,
      recipientMembershipId: null,
      recipientPhone: input.phone,
      channel: 'SMS',
      type: input.type,
      studentId: input.studentId,
      tripId: input.tripId ?? null,
      refId: input.refId ?? null,
      dedupeKey: `${input.dedupe}:SMS:${input.phone}`,
    })
    .onConflictDoNothing({ target: [notification.tenantId, notification.dedupeKey] });
}
