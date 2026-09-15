import { exhaustive } from './exhaustive.js';
import { haversineMeters, type LatLng } from './haversine.js';
import { URBAN_BUS_SPEED_MPS, type BaselineLeg } from './route-baseline.js';

export const DEFAULT_APPROACH_MINUTES = 5;
/** 12 saat: bundan uzun bir ETA veri hatasıdır, ekranda gösterilmez. */
export const MAX_ETA_SECONDS = 12 * 60 * 60;
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
  return Math.max(1, Math.round(baselineSec * (1 - historyWeight) + medianSeconds * historyWeight));
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
  /** Varışı doğrulanmış son durağın sırası; rota ilerleyişi buradan geri saramaz. */
  lastArrivedSeq?: number | null;
}): number {
  const ordered = [...input.stops].sort((a, b) => a.seq - b.seq);
  const target = ordered.find((stop) => stop.id === input.targetStopId);
  if (!target) {
    return finiteSeconds(
      haversineMeters(input.vehicle, ordered[0] ?? input.vehicle) / URBAN_BUS_SPEED_MPS,
    );
  }
  // Geometrik en yakın durak tek başına yeterli değil: yol kıvrıldığında araç,
  // çoktan geçtiği bir durağa yeniden yaklaşabilir ve ETA geri sarabilirdi.
  // Varışı kaydedilmiş duraklar zemin oluşturur.
  const nearest = nearestStop(input.vehicle, ordered);
  let startSeq = nearest && nearest.seq <= target.seq ? nearest.seq : target.seq;
  const arrived = input.lastArrivedSeq;
  if (arrived !== undefined && arrived !== null && startSeq <= arrived) {
    const next = ordered.find((stop) => stop.seq > arrived);
    startSeq = Math.min(next ? next.seq : target.seq, target.seq);
  }
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
  return finiteSeconds(total * factor);
}

/**
 * ETA saniyesi her zaman sonlu bir pozitif tam sayıdır.
 *
 * Tek bir NaN (bozuk koordinat, sıfır hız, eksik bacak) `eta_seconds::integer`
 * yazımında patlar; bu da o araçtan gelen HER GPS ping'inin 500 dönmesi
 * demektir. Hesap bozulursa ETA'yı kaybetmek, canlı takibi kaybetmekten iyidir.
 */
function finiteSeconds(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ETA_SECONDS, Math.max(1, Math.round(value)));
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

/**
 * Sayı olarak gösterilebilir bir ETA mı?
 *
 * `finiteSeconds` ufkun dışındaki her değeri MAX_ETA_SECONDS'a KIRPAR; kırpma
 * hesabı kurtarmak için vardır, sonucu doğrulamak için değil. Kırpılmış değer
 * ekrana gidince veli "Yaklaşık 720 dk" görüyordu: araç rotanın 800 km dışında
 * bir koordinat bildirdiğinde (yanlış cihaz konumu, eski oturum) çıkan tam
 * olarak budur ve güven puanı 0.75 ile "yüksek" görünür. On iki saatlik bir
 * servis tahmini bilgi değil, gürültüdür.
 */
export function etaWithinHorizon(etaSeconds: number): boolean {
  return Number.isFinite(etaSeconds) && etaSeconds > 0 && etaSeconds < MAX_ETA_SECONDS;
}

/** Ufuk dışındaysa metin YOKTUR: uydurma bir süre yerine hiçbir şey. */
export function formatParentEta(input: {
  etaSeconds: number;
  confidence: number;
}): ParentEtaPhrase | null {
  if (!etaWithinHorizon(input.etaSeconds)) return null;
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

/**
 * Eşiği AŞAĞI doğru geçtiğimiz ping'te bildirilir. Eski koşul "önceki ETA da
 * eşiğin altındaydı" diyordu; bu tam da geçişin yaşandığı ping'i atlayıp
 * bildirimi bir tur geciktiriyordu. İlk ölçüm zaten eşiğin altındaysa (veli
 * ekranı geç açtı, sefer yakında başladı) beklenmez — `approachNotifiedAt`
 * zaten tekrarı engelliyor.
 */
export function shouldNotifyApproach(input: {
  etaSeconds: number;
  previousEtaSeconds: number | null;
  approachNotifiedAt: string | null;
  thresholdMinutes?: number;
}): boolean {
  if (input.approachNotifiedAt) return false;
  const threshold = (input.thresholdMinutes ?? DEFAULT_APPROACH_MINUTES) * 60;
  if (input.etaSeconds > threshold) return false;
  if (input.previousEtaSeconds === null) return true;
  return input.previousEtaSeconds > threshold;
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
