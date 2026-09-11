import { haversineMeters, type LatLng } from './haversine.js';

/** ComputeRoutes: origin + dest + max 25 ara durak = 27 nokta. */
export const ROUTES_MAX_POINTS_PER_REQUEST = 27;
export const URBAN_BUS_SPEED_MPS = 6;
export const MIN_ROUTE_REFRESH_INTERVAL_MS = 5 * 60_000;
export const MAX_ROUTES_CALLS_PER_TRIP = 5;
export const OFF_ROUTE_REFRESH_M = 400;
export const UNEXPECTED_STOP_REFRESH_MS = 4 * 60_000;
export const ETA_CONFIDENCE_REFRESH_THRESHOLD = 0.35;

export interface RoutePoint extends LatLng {
  id: string;
}

export interface BaselineLeg {
  fromStopId: string;
  toStopId: string;
  durationSec: number;
  distanceM: number;
}

export interface RouteBaseline {
  source: 'google' | 'haversine';
  computedAt: string;
  legs: BaselineLeg[];
}

export interface BaselineChunk {
  startIndex: number;
  endIndex: number;
  /** Önceki parçanın tahmini varışına göre kalkış kayması (sn). */
  departureOffsetSec: number;
}

/**
 * Sequential assembly: chunk N kalkışı = chunk N-1 tahmini varışı.
 * Tüm parçalara departureTime=now verilmez.
 */
export function chunkRoutePoints(pointCount: number): BaselineChunk[] {
  if (pointCount < 2) return [];
  const chunks: BaselineChunk[] = [];
  let start = 0;
  while (start < pointCount - 1) {
    const end = Math.min(pointCount - 1, start + ROUTES_MAX_POINTS_PER_REQUEST - 1);
    chunks.push({ startIndex: start, endIndex: end, departureOffsetSec: 0 });
    if (end === pointCount - 1) break;
    start = end;
  }
  return chunks;
}

export function assembleSequentialOffsets(
  chunks: readonly BaselineChunk[],
  chunkDurationSec: readonly number[],
): BaselineChunk[] {
  let offset = 0;
  return chunks.map((chunk, index) => {
    const next = { ...chunk, departureOffsetSec: offset };
    offset += chunkDurationSec[index] ?? 0;
    return next;
  });
}

/**
 * Google yokken de aynı parçalama + sequential offset yolu kullanılır.
 * Chunk N kalkışı chunk N-1 varışına bağlanır; bacaklar örtüşen kenarda tekilleşir.
 */
export function chunkedHaversineBaseline(
  points: readonly RoutePoint[],
  now = new Date(),
): RouteBaseline {
  const chunks = chunkRoutePoints(points.length);
  if (chunks.length === 0) {
    return { source: 'haversine', computedAt: now.toISOString(), legs: [] };
  }
  const parts: BaselineLeg[][] = [];
  const chunkDurationSec: number[] = [];
  for (const chunk of chunks) {
    const slice = points.slice(chunk.startIndex, chunk.endIndex + 1);
    const part = haversineBaseline(slice, now);
    parts.push(part.legs);
    chunkDurationSec.push(part.legs.reduce((sum, leg) => sum + leg.durationSec, 0));
  }
  assembleSequentialOffsets(chunks, chunkDurationSec);
  return {
    source: 'haversine',
    computedAt: now.toISOString(),
    legs: mergeChunkLegs(parts),
  };
}

export function haversineBaseline(points: readonly RoutePoint[], now = new Date()): RouteBaseline {
  const legs: BaselineLeg[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    if (!from || !to) continue;
    const distanceM = haversineMeters(from, to);
    legs.push({
      fromStopId: from.id,
      toStopId: to.id,
      distanceM,
      durationSec: Math.max(1, Math.round(distanceM / URBAN_BUS_SPEED_MPS)),
    });
  }
  return {
    source: 'haversine',
    computedAt: now.toISOString(),
    legs,
  };
}

export function mergeChunkLegs(parts: readonly BaselineLeg[][]): BaselineLeg[] {
  const merged: BaselineLeg[] = [];
  for (const part of parts) {
    for (const leg of part) {
      const last = merged.at(-1);
      if (last && last.fromStopId === leg.fromStopId && last.toStopId === leg.toStopId) continue;
      merged.push(leg);
    }
  }
  return merged;
}

export interface RoutesRefreshInput {
  nowMs: number;
  lastRoutesCallAtMs: number | null;
  routesCallsCount: number;
  offRouteM: number | null;
  unexpectedStopMs: number | null;
  etaConfidence: number | null;
  routeChanged: boolean;
  seriousEtaMiss: boolean;
}

export function shouldRefreshRoutes(input: RoutesRefreshInput): boolean {
  if (input.routesCallsCount >= MAX_ROUTES_CALLS_PER_TRIP) return false;
  if (
    input.lastRoutesCallAtMs !== null &&
    input.nowMs - input.lastRoutesCallAtMs < MIN_ROUTE_REFRESH_INTERVAL_MS
  ) {
    return false;
  }
  if (input.routeChanged) return true;
  if (input.seriousEtaMiss) return true;
  if (input.offRouteM !== null && input.offRouteM >= OFF_ROUTE_REFRESH_M) return true;
  if (input.unexpectedStopMs !== null && input.unexpectedStopMs >= UNEXPECTED_STOP_REFRESH_MS) {
    return true;
  }
  if (input.etaConfidence !== null && input.etaConfidence < ETA_CONFIDENCE_REFRESH_THRESHOLD) {
    return true;
  }
  return false;
}

export function distanceToPolylineM(point: LatLng, path: readonly LatLng[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) {
    const only = path[0];
    return only ? haversineMeters(point, only) : Number.POSITIVE_INFINITY;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    best = Math.min(best, distanceToSegmentM(point, a, b));
  }
  return best;
}

function distanceToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const ab = haversineMeters(a, b);
  if (ab < 1) return haversineMeters(p, a);
  const ap = haversineMeters(p, a);
  const bp = haversineMeters(p, b);
  if (ap ** 2 > ab ** 2 + bp ** 2) return bp;
  if (bp ** 2 > ab ** 2 + ap ** 2) return ap;
  const s = (ab + ap + bp) / 2;
  const area2 = Math.max(0, s * (s - ab) * (s - ap) * (s - bp));
  return (2 * Math.sqrt(area2)) / ab;
}
