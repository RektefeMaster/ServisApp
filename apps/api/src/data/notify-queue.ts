import { notification, studentGuardian, type Database } from '@servisapp/db';
import { and, eq } from 'drizzle-orm';
import { isUniqueViolation } from './db-error.js';

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
    .where(
      and(
        eq(studentGuardian.tenantId, input.tenantId),
        eq(studentGuardian.studentId, input.studentId),
        eq(studentGuardian.status, 'ACTIVE'),
      ),
    );
  for (const row of rows) {
    if (input.requireAuthorizeTempAddress && !row.canAuthorizeTempAddress) continue;
    try {
      await tx.insert(notification).values({
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
      });
    } catch (error) {
      if (!isUniqueViolation(error, 'notification_dedupe')) throw error;
    }
  }
}
