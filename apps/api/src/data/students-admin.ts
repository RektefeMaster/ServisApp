import {
  guardianInvite,
  identity,
  inviteSms,
  membershipRole,
  school,
  student,
  studentGuardian,
  tenantMembership,
  trip,
  tripStudent,
  type Database,
} from '@servisapp/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { notFound } from '../http-error.js';
import { loadAssignments, loadPinnedUsages, planForStudent } from './plan-query.js';
import type { StaffListItem, StudentGuardianView, StudentListItem } from './ports.js';

export async function listStaffTx(tx: Database, tenantId: string): Promise<StaffListItem[]> {
  const rows = await tx
    .select({
      membershipId: tenantMembership.id,
      identityId: identity.id,
      fullName: identity.fullName,
      phone: identity.phoneE164,
      email: identity.email,
      status: tenantMembership.status,
      role: membershipRole.role,
    })
    .from(tenantMembership)
    .innerJoin(identity, eq(identity.id, tenantMembership.identityId))
    .innerJoin(
      membershipRole,
      and(
        eq(membershipRole.membershipId, tenantMembership.id),
        eq(membershipRole.tenantId, tenantId),
      ),
    )
    .where(eq(tenantMembership.tenantId, tenantId));

  const byMembership = new Map<string, StaffListItem>();
  for (const row of rows) {
    if (row.role === 'GUARDIAN') continue;
    const current = byMembership.get(row.membershipId);
    if (current) {
      current.roles.push(row.role);
      continue;
    }
    byMembership.set(row.membershipId, {
      membershipId: row.membershipId,
      identityId: row.identityId,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email,
      status: row.status,
      roles: [row.role],
    });
  }
  return [...byMembership.values()];
}

export async function listStudentsTx(
  tx: Database,
  tenantId: string,
  studentId?: string,
): Promise<StudentListItem[]> {
  const rows = await tx
    .select({
      id: student.id,
      fullName: student.fullName,
      schoolId: student.schoolId,
      schoolName: school.name,
      grade: student.grade,
      enrollmentEnd: student.enrollmentEnd,
      usesMorning: student.usesMorning,
      usesEvening: student.usesEvening,
      suspended: student.suspended,
    })
    .from(student)
    .innerJoin(school, and(eq(school.id, student.schoolId), eq(school.tenantId, tenantId)))
    .where(
      studentId
        ? and(eq(student.tenantId, tenantId), eq(student.id, studentId))
        : eq(student.tenantId, tenantId),
    );

  const ids = rows.map((row) => row.id);
  const assignments = await loadAssignments(tx, tenantId, ids);
  const pinned = await loadPinnedUsages(tx, tenantId, ids);
  const guardians = await loadGuardians(tx, tenantId, ids);

  return rows.map((row) => {
    const plan = planForStudent(
      {
        enrollmentEnd: row.enrollmentEnd,
        suspended: row.suspended,
        usesMorning: row.usesMorning,
        usesEvening: row.usesEvening,
      },
      assignments.get(row.id) ?? [],
      pinned.has(row.id),
    );
    return {
      id: row.id,
      fullName: row.fullName,
      schoolId: row.schoolId,
      schoolName: row.schoolName,
      grade: row.grade,
      enrollmentEnd: row.enrollmentEnd,
      usesMorning: row.usesMorning,
      usesEvening: row.usesEvening,
      suspended: row.suspended,
      morningPlanStatus: plan.morning,
      eveningPlanStatus: plan.evening,
      addressVerification: plan.addressVerification,
      guardians: guardians.get(row.id) ?? [],
    };
  });
}

export async function getStudentTx(
  tx: Database,
  tenantId: string,
  studentId: string,
): Promise<StudentListItem | null> {
  const items = await listStudentsTx(tx, tenantId, studentId);
  return items[0] ?? null;
}

export async function endStudentTx(
  tx: Database,
  tenantId: string,
  studentId: string,
  enrollmentEnd: string,
): Promise<{ id: string; enrollmentEnd: string }> {
  const [row] = await tx
    .update(student)
    .set({ enrollmentEnd })
    .where(and(eq(student.id, studentId), eq(student.tenantId, tenantId)))
    .returning({ id: student.id, enrollmentEnd: student.enrollmentEnd });
  if (!row?.enrollmentEnd) throw notFound('Öğrenci bulunamadı');
  await dropStudentFromOpenTrips(tx, tenantId, studentId);
  return { id: row.id, enrollmentEnd: row.enrollmentEnd };
}

async function dropStudentFromOpenTrips(
  tx: Database,
  tenantId: string,
  studentId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: tripStudent.id })
    .from(tripStudent)
    .innerJoin(trip, and(eq(trip.id, tripStudent.tripId), eq(trip.tenantId, tenantId)))
    .where(
      and(
        eq(tripStudent.tenantId, tenantId),
        eq(tripStudent.studentId, studentId),
        eq(tripStudent.state, 'EXPECTED'),
        inArray(trip.state, ['PLANNED', 'READY']),
      ),
    );
  if (rows.length === 0) return;
  await tx
    .update(tripStudent)
    .set({ state: 'MOVED_OUT' })
    .where(
      and(
        eq(tripStudent.tenantId, tenantId),
        inArray(
          tripStudent.id,
          rows.map((row) => row.id),
        ),
      ),
    );
}

export async function revokeGuardianTx(
  tx: Database,
  tenantId: string,
  studentId: string,
  membershipId: string,
): Promise<{ status: 'REVOKED' }> {
  const [row] = await tx
    .update(studentGuardian)
    .set({ status: 'REVOKED' })
    .where(
      and(
        eq(studentGuardian.tenantId, tenantId),
        eq(studentGuardian.studentId, studentId),
        eq(studentGuardian.guardianMembershipId, membershipId),
      ),
    )
    .returning({ id: studentGuardian.id });
  if (!row) throw notFound('Veli ilişkisi bulunamadı');
  return { status: 'REVOKED' };
}

async function loadGuardians(
  tx: Database,
  tenantId: string,
  studentIds: string[],
): Promise<Map<string, StudentGuardianView[]>> {
  const map = new Map<string, StudentGuardianView[]>();
  if (studentIds.length === 0) return map;
  const rows = await tx
    .select({
      studentId: studentGuardian.studentId,
      membershipId: studentGuardian.guardianMembershipId,
      identityId: identity.id,
      fullName: identity.fullName,
      phone: identity.phoneE164,
      relation: studentGuardian.relation,
      status: studentGuardian.status,
    })
    .from(studentGuardian)
    .innerJoin(
      tenantMembership,
      and(
        eq(tenantMembership.id, studentGuardian.guardianMembershipId),
        eq(tenantMembership.tenantId, tenantId),
      ),
    )
    .innerJoin(identity, eq(identity.id, tenantMembership.identityId))
    .where(
      and(eq(studentGuardian.tenantId, tenantId), inArray(studentGuardian.studentId, studentIds)),
    );
  const membershipIds = [...new Set(rows.map((row) => row.membershipId))];
  const inviteByMembership = await loadLatestInvites(tx, tenantId, membershipIds);

  for (const row of rows) {
    const invite = inviteByMembership.get(row.membershipId);
    const list = map.get(row.studentId) ?? [];
    list.push({
      membershipId: row.membershipId,
      identityId: row.identityId,
      inviteId: invite?.inviteId ?? null,
      fullName: row.fullName,
      phone: row.phone,
      relation: row.relation,
      status: row.status,
      inviteStatus: invite?.status ?? null,
      smsStatus: invite?.smsStatus ?? null,
    });
    map.set(row.studentId, list);
  }
  return map;
}

async function loadLatestInvites(
  tx: Database,
  tenantId: string,
  membershipIds: string[],
): Promise<
  Map<
    string,
    {
      inviteId: string;
      status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED';
      smsStatus: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | null;
    }
  >
> {
  const map = new Map<
    string,
    {
      inviteId: string;
      status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED';
      smsStatus: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | null;
    }
  >();
  if (membershipIds.length === 0) return map;
  const invites = await tx
    .select({
      id: guardianInvite.id,
      membershipId: guardianInvite.membershipId,
      status: guardianInvite.status,
      createdAt: guardianInvite.createdAt,
    })
    .from(guardianInvite)
    .where(
      and(
        eq(guardianInvite.tenantId, tenantId),
        inArray(guardianInvite.membershipId, membershipIds),
      ),
    )
    .orderBy(desc(guardianInvite.createdAt));
  const latest = new Map<string, (typeof invites)[number]>();
  for (const invite of invites) {
    if (!latest.has(invite.membershipId)) latest.set(invite.membershipId, invite);
  }
  const inviteIds = [...latest.values()].map((item) => item.id);
  const smsByInvite = new Map<string, 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED'>();
  if (inviteIds.length > 0) {
    const smsRows = await tx
      .select({
        inviteId: inviteSms.inviteId,
        status: inviteSms.status,
        createdAt: inviteSms.createdAt,
      })
      .from(inviteSms)
      .where(and(eq(inviteSms.tenantId, tenantId), inArray(inviteSms.inviteId, inviteIds)))
      .orderBy(desc(inviteSms.createdAt));
    for (const row of smsRows) {
      if (!smsByInvite.has(row.inviteId)) smsByInvite.set(row.inviteId, row.status);
    }
  }
  for (const [membershipId, invite] of latest) {
    map.set(membershipId, {
      inviteId: invite.id,
      status: invite.status,
      smsStatus: smsByInvite.get(invite.id) ?? null,
    });
  }
  return map;
}
