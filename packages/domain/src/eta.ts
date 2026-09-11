import { exhaustive } from './exhaustive.js';
import { haversineMeters, type LatLng } from './haversine.js';
import { URBAN_BUS_SPEED_MPS, type BaselineLeg } from './route-baseline.js';

export const DEFAULT_APPROACH_MINUTES = 5;
export const ETA_DISPLAY_LOW_CONFIDENCE = 0.4;

export interface ObservedLeg {
  fromStopId: string;
  toStopId: string;
  actualDurationSec: number;
}

export interface EtaStop extends LatLng {
  id: string;
  seq: number;
}

/** Geçmiş sefer medyanı yoksa veya örnek azsa baseline aynen kalır. */
export const SEGMENT_STAT_MIN_SAMPLES = 5;

export function blendSegmentSeconds(
  baselineSec: number,
  sampleCount: number,
  medianSeconds: number | null,
): number {
  if (sampleCount < SEGMENT_STAT_MIN_SAMPLES || medianSeconds === null || medianSeconds <= 0) {
    return Math.max(1, Math.round(baselineSec));
  }
  const historyWeight = Math.min(0.65, sampleCount / 40);
  return Math.max(
    1,
    Math.round(baselineSec * (1 - historyWeight) + medianSeconds * historyWeight),
  );
}

export function delayFactor(
  legs: readonly BaselineLeg[],
  observed: readonly ObservedLeg[],
): number {
  if (observed.length === 0) return 1;
  const byKey = new Map(legs.map((leg) => [`${leg.fromStopId}:${leg.toStopId}`, leg.durationSec]));
  let weighted = 0;
  let weightSum = 0;
  observed.forEach((item, index) => {
    const baseline = byKey.get(`${item.fromStopId}:${item.toStopId}`);
    if (!baseline || baseline <= 0 || item.actualDurationSec <= 0) return;
    const recency = index + 1;
    weighted += (item.actualDurationSec / baseline) * recency;
    weightSum += recency;
  });
  if (weightSum === 0) return 1;
  return Math.min(3, Math.max(0.5, weighted / weightSum));
}

export function remainingEtaSeconds(input: {
  vehicle: LatLng;
  stops: readonly EtaStop[];
  targetStopId: string;
  legs: readonly BaselineLeg[];
  observed: readonly ObservedLeg[];
}): number {
  const ordered = [...input.stops].sort((a, b) => a.seq - b.seq);
  const target = ordered.find((stop) => stop.id === input.targetStopId);
  if (!target) {
    return Math.max(1, Math.round(haversineMeters(input.vehicle, ordered[0] ?? input.vehicle) / URBAN_BUS_SPEED_MPS));
  }
  const nearest = nearestStop(input.vehicle, ordered);
  const startSeq = nearest && nearest.seq <= target.seq ? nearest.seq : target.seq;
  const factor = delayFactor(input.legs, input.observed);
  const first = ordered.find((stop) => stop.seq >= startSeq) ?? target;
  let total = haversineMeters(input.vehicle, first) / URBAN_BUS_SPEED_MPS;
  const byFrom = new Map(input.legs.map((leg) => [leg.fromStopId, leg]));
  let cursor = first;
  const guard = new Set<string>();
  while (cursor.id !== target.id) {
    if (guard.has(cursor.id)) break;
    guard.add(cursor.id);
    const leg = byFrom.get(cursor.id);
    if (leg) {
      total += leg.durationSec;
      const next = ordered.find((stop) => stop.id === leg.toStopId);
      if (!next) break;
      cursor = next;
      continue;
    }
    const next = ordered.find((stop) => stop.seq > cursor.seq);
    if (!next) break;
    total += haversineMeters(cursor, next) / URBAN_BUS_SPEED_MPS;
    cursor = next;
  }
  return Math.max(1, Math.round(total * factor));
}

function nearestStop(point: LatLng, stops: readonly EtaStop[]): EtaStop | null {
  let best: EtaStop | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const stop of stops) {
    const d = haversineMeters(point, stop);
    if (d < bestD) {
      bestD = d;
      best = stop;
    }
  }
  return best;
}

export function etaConfidence(input: {
  gpsAgeMs: number | null;
  accuracyM: number | null;
  offRouteM: number | null;
  hasBaseline: boolean;
  delayFactor: number;
}): number {
  if (!input.hasBaseline) return 0.3;
  let score = 1;
  if (input.gpsAgeMs === null) score -= 0.4;
  else if (input.gpsAgeMs > 180_000) score -= 0.45;
  else if (input.gpsAgeMs > 30_000) score -= 0.2;
  if (input.accuracyM !== null && input.accuracyM > 40) score -= 0.15;
  if (input.offRouteM !== null && input.offRouteM > 150) score -= 0.25;
  if (input.delayFactor > 1.6 || input.delayFactor < 0.7) score -= 0.1;
  return Math.min(1, Math.max(0, score));
}

export type ParentEtaPhrase = 'Yaklaşıyor' | `Yaklaşık ${number} dk` | `${number}-${number} dk`;

export function formatParentEta(input: {
  etaSeconds: number;
  confidence: number;
}): ParentEtaPhrase {
  if (input.confidence < ETA_DISPLAY_LOW_CONFIDENCE) return 'Yaklaşıyor';
  const minutes = Math.max(1, Math.round(input.etaSeconds / 60));
  if (minutes <= 2) return 'Yaklaşıyor';
  if (input.confidence < 0.7) {
    const lo = Math.max(1, minutes - 1);
    const hi = minutes + 1;
    return `${lo}-${hi} dk`;
  }
  return `Yaklaşık ${minutes} dk`;
}

export function shouldNotifyApproach(input: {
  etaSeconds: number;
  previousEtaSeconds: number | null;
  approachNotifiedAt: string | null;
  thresholdMinutes?: number;
}): boolean {
  if (input.approachNotifiedAt) return false;
  const threshold = (input.thresholdMinutes ?? DEFAULT_APPROACH_MINUTES) * 60;
  if (input.etaSeconds > threshold) return false;
  if (input.previousEtaSeconds === null) return false;
  return input.previousEtaSeconds <= threshold;
}

export function parentEtaVisible(confidence: number): boolean {
  return confidence >= 0;
}

export function approachThresholdSeconds(minutes = DEFAULT_APPROACH_MINUTES): number {
  return minutes * 60;
}

export function describeEtaConfidence(confidence: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (confidence >= 0.7) return 'HIGH';
  if (confidence >= 0.4) return 'MEDIUM';
  return 'LOW';
}

export function etaBand(confidence: 'HIGH' | 'MEDIUM' | 'LOW'): string {
  switch (confidence) {
    case 'HIGH':
      return 'HIGH';
    case 'MEDIUM':
      return 'MEDIUM';
    case 'LOW':
      return 'LOW';
    default:
      return exhaustive(confidence, 'etaBand');
  }
}
