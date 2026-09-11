import { route, routeVersion, type Database } from '@servisapp/db';
import { and, eq, inArray } from 'drizzle-orm';

export interface HorizonRouteVersion {
  routeId: string;
  vehicleId: string;
  schoolId: string;
  segment: 'MORNING' | 'AFTERNOON';
  versionId: string;
  versionNo: number;
  effectiveFrom: string | Date;
}

function ymdOf(value: string | Date): string {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match?.[1]) return match[1];
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

export async function loadHorizonRouteVersions(
  tx: Database,
  tenantId: string,
): Promise<HorizonRouteVersion[]> {
  return tx
    .select({
      routeId: route.id,
      vehicleId: route.vehicleId,
      schoolId: route.schoolId,
      segment: route.segment,
      versionId: routeVersion.id,
      versionNo: routeVersion.versionNo,
      effectiveFrom: routeVersion.effectiveFrom,
    })
    .from(routeVersion)
    .innerJoin(route, and(eq(route.id, routeVersion.routeId), eq(route.tenantId, tenantId)))
    .where(
      and(
        eq(routeVersion.tenantId, tenantId),
        inArray(routeVersion.status, ['PUBLISHED', 'ARCHIVED']),
      ),
    );
}

/** Bir gün için rotanın geçerli sürümü: effectiveFrom <= gün, en yeni tarih/sürüm. */
export function pickApplicableRouteVersions(
  versions: HorizonRouteVersion[],
  serviceDate: string,
): HorizonRouteVersion[] {
  const chosen = new Map<string, HorizonRouteVersion>();
  for (const item of versions) {
    const from = ymdOf(item.effectiveFrom);
    if (from > serviceDate) continue;
    const previous = chosen.get(item.routeId);
    if (!previous) {
      chosen.set(item.routeId, item);
      continue;
    }
    const previousFrom = ymdOf(previous.effectiveFrom);
    if (from > previousFrom || (from === previousFrom && item.versionNo > previous.versionNo)) {
      chosen.set(item.routeId, item);
    }
  }
  return [...chosen.values()];
}
