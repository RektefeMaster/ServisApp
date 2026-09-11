import {
  canReadGuardianChild,
  hasUsableCoordinates,
  isEnrollmentEnded,
  segmentPlanStatus,
  ymdInTimeZone,
  type StudentPlanStatus,
} from '@servisapp/domain';
import {
  route,
  routeStop,
  routeStopStudent,
  routeVersion,
  school,
  stop,
  student,
  studentAddress,
  studentGuardian,
  tenant,
  type Database,
} from '@servisapp/db';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { loadHorizonRouteVersions, pickApplicableRouteVersions } from './applicable-route-versions.js';

export interface StudentPlanPair {
  morning: StudentPlanStatus;
  evening: StudentPlanStatus;
  addressVerification: 'PINNED' | 'PENDING';
}

interface Assignment {
  studentId: string;
  segment: 'MORNING' | 'AFTERNOON';
  lat: number;
  lng: number;
}

export async function loadAssignments(
  tx: Database,
  tenantId: string,
  studentIds: string[],
): Promise<Map<string, Assignment[]>> {
  const map = new Map<string, Assignment[]>();
  if (studentIds.length === 0) return map;
  const [tenantRow] = await tx
    .select({ timezone: tenant.timezone })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const asOf = ymdInTimeZone(new Date(), tenantRow?.timezone ?? 'Europe/Istanbul');
  const applicableIds = pickApplicableRouteVersions(
    await loadHorizonRouteVersions(tx, tenantId),
    asOf,
  ).map((item) => item.versionId);
  if (applicableIds.length === 0) return map;
  const rows = await tx
    .select({
      studentId: routeStopStudent.studentId,
      segment: route.segment,
      lat: stop.lat,
      lng: stop.lng,
    })
    .from(routeStopStudent)
    .innerJoin(
      routeStop,
      and(eq(routeStop.id, routeStopStudent.routeStopId), eq(routeStop.tenantId, tenantId)),
    )
    .innerJoin(
      routeVersion,
      and(
        eq(routeVersion.id, routeStop.routeVersionId),
        eq(routeVersion.tenantId, tenantId),
        inArray(routeVersion.id, applicableIds),
      ),
    )
    .innerJoin(route, and(eq(route.id, routeVersion.routeId), eq(route.tenantId, tenantId)))
    .innerJoin(stop, and(eq(stop.id, routeStop.stopId), eq(stop.tenantId, tenantId)))
    .where(
      and(eq(routeStopStudent.tenantId, tenantId), inArray(routeStopStudent.studentId, studentIds)),
    );
  for (const row of rows) {
    const list = map.get(row.studentId) ?? [];
    list.push({
      studentId: row.studentId,
      segment: row.segment,
      lat: row.lat,
      lng: row.lng,
    });
    map.set(row.studentId, list);
  }
  return map;
}

export async function loadPinnedUsages(
  tx: Database,
  tenantId: string,
  studentIds: string[],
): Promise<Set<string>> {
  const pinned = new Set<string>();
  if (studentIds.length === 0) return pinned;
  const rows = await tx
    .select({ studentId: studentAddress.studentId })
    .from(studentAddress)
    .where(
      and(
        eq(studentAddress.tenantId, tenantId),
        inArray(studentAddress.studentId, studentIds),
        sql`${studentAddress.validFrom} <= current_date`,
        or(isNull(studentAddress.validTo), sql`${studentAddress.validTo} >= current_date`),
      ),
    );
  for (const row of rows) pinned.add(row.studentId);
  return pinned;
}

export function planForStudent(
  row: {
    enrollmentEnd: string | null;
    suspended: boolean;
    usesMorning: boolean;
    usesEvening: boolean;
  },
  assignments: Assignment[],
  hasPinnedAddress: boolean,
  asOfYmd: string,
): StudentPlanPair {
  const ended = isEnrollmentEnded(row.enrollmentEnd, asOfYmd);
  const morningHit = assignments.find((item) => item.segment === 'MORNING');
  const eveningHit = assignments.find((item) => item.segment === 'AFTERNOON');
  return {
    morning: segmentPlanStatus({
      studentEnded: ended,
      studentSuspended: row.suspended,
      usesSegment: row.usesMorning,
      publishedAssignment: Boolean(morningHit),
      stopHasCoordinates: morningHit
        ? hasUsableCoordinates(morningHit.lat, morningHit.lng)
        : false,
    }),
    evening: segmentPlanStatus({
      studentEnded: ended,
      studentSuspended: row.suspended,
      usesSegment: row.usesEvening,
      publishedAssignment: Boolean(eveningHit),
      stopHasCoordinates: eveningHit
        ? hasUsableCoordinates(eveningHit.lat, eveningHit.lng)
        : false,
    }),
    addressVerification: hasPinnedAddress ? 'PINNED' : 'PENDING',
  };
}

export async function loadParentChildren(
  tx: Database,
  tenantId: string,
  membershipId: string,
  membershipStatus: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED',
): Promise<
  Array<{
    studentId: string;
    fullName: string;
    schoolName: string;
    morningPlanStatus: StudentPlanStatus;
    eveningPlanStatus: StudentPlanStatus;
  }>
> {
  const rows = await tx
    .select({
      studentId: student.id,
      fullName: student.fullName,
      schoolName: school.name,
      enrollmentEnd: student.enrollmentEnd,
      suspended: student.suspended,
      usesMorning: student.usesMorning,
      usesEvening: student.usesEvening,
      relationStatus: studentGuardian.status,
    })
    .from(studentGuardian)
    .innerJoin(
      student,
      and(eq(student.id, studentGuardian.studentId), eq(student.tenantId, tenantId)),
    )
    .innerJoin(school, and(eq(school.id, student.schoolId), eq(school.tenantId, tenantId)))
    .where(
      and(
        eq(studentGuardian.tenantId, tenantId),
        eq(studentGuardian.guardianMembershipId, membershipId),
      ),
    );

  const [tenantRow] = await tx
    .select({ timezone: tenant.timezone })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const asOf = ymdInTimeZone(new Date(), tenantRow?.timezone ?? 'Europe/Istanbul');
  const visible = rows.filter((row) =>
    canReadGuardianChild({
      membershipStatus,
      guardianRelationStatus: row.relationStatus,
      studentEnded: isEnrollmentEnded(row.enrollmentEnd, asOf),
    }),
  );
  const ids = visible.map((row) => row.studentId);
  const assignments = await loadAssignments(tx, tenantId, ids);
  const pinned = await loadPinnedUsages(tx, tenantId, ids);
  return visible.map((row) => {
    const plan = planForStudent(
      row,
      assignments.get(row.studentId) ?? [],
      pinned.has(row.studentId),
      asOf,
    );
    return {
      studentId: row.studentId,
      fullName: row.fullName,
      schoolName: row.schoolName,
      morningPlanStatus: plan.morning,
      eveningPlanStatus: plan.evening,
    };
  });
}
