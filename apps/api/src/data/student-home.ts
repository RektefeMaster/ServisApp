import { address, studentAddress, type Database } from '@servisapp/db';
import { expectedStopKind, type HorizonSegment } from '@servisapp/domain';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

export interface StudentHomePoint {
  lat: number;
  lng: number;
  text: string;
}

export async function studentHomePoints(
  tx: Database,
  tenantId: string,
  studentIds: string[],
  onDate: string,
  segment: HorizonSegment,
): Promise<Map<string, StudentHomePoint>> {
  const result = new Map<string, StudentHomePoint>();
  if (studentIds.length === 0) return result;
  const preferred = expectedStopKind(segment) === 'PICKUP' ? 'PICKUP' : 'DROPOFF';
  const rows = await tx
    .select({
      studentId: studentAddress.studentId,
      usage: studentAddress.usage,
      lat: address.lat,
      lng: address.lng,
      text: address.text,
    })
    .from(studentAddress)
    .innerJoin(
      address,
      and(eq(address.id, studentAddress.addressId), eq(address.tenantId, tenantId)),
    )
    .where(
      and(
        eq(studentAddress.tenantId, tenantId),
        inArray(studentAddress.studentId, studentIds),
        sql`${studentAddress.validFrom} <= ${onDate}`,
        or(isNull(studentAddress.validTo), sql`${studentAddress.validTo} >= ${onDate}`),
      ),
    );
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.studentId) ?? [];
    list.push(row);
    grouped.set(row.studentId, list);
  }
  for (const [studentId, list] of grouped) {
    const hit = list.find((row) => row.usage === preferred) ?? list[0];
    if (hit) result.set(studentId, { lat: hit.lat, lng: hit.lng, text: hit.text });
  }
  return result;
}

export async function studentHomePoint(
  tx: Database,
  tenantId: string,
  studentId: string,
  onDate: string,
  segment: HorizonSegment,
): Promise<StudentHomePoint | null> {
  const map = await studentHomePoints(tx, tenantId, [studentId], onDate, segment);
  return map.get(studentId) ?? null;
}
