import { exhaustive } from './exhaustive.js';
import { haversineMeters, type LatLng } from './haversine.js';

export const LOCATION_QUALITIES = ['GOOD', 'LOW', 'REJECTED'] as const;
export type LocationQuality = (typeof LOCATION_QUALITIES)[number];

export const GPS_REJECT_REASONS = [
  'ACCURACY',
  'IMPOSSIBLE_SPEED',
  'JUMP',
  'STALE_RECORDED_AT',
  'FUTURE_RECORDED_AT',
] as const;
export type GpsRejectReason = (typeof GPS_REJECT_REASONS)[number];

export const GPS_AUTH_REASONS = [
  'WRONG_TRIP',
  'WRONG_EPOCH',
  'WRONG_DEVICE',
  'DEVICE_REVOKED',
  'TRIP_NOT_ACTIVE',
  'GPS_KILLED',
] as const;
export type GpsAuthReason = (typeof GPS_AUTH_REASONS)[number];

/** accuracy üstü reddedilir; 40–75 m arası LOW. */
export const GPS_ACCURACY_REJECT_M = 75;
export const GPS_ACCURACY_LOW_M = 40;
/** 144 km/s üzeri okul servisi için imkânsız. */
export const GPS_MAX_SPEED_MPS = 40;
/** Yüzlerce metrelik ani sıçrama. */
export const GPS_JUMP_REJECT_M = 400;
export const GPS_STALE_RECORDED_MS = 60_000;
export const GPS_FUTURE_SKEW_MS = 15_000;
export const PING_ARCHIVE_INTERVAL_MS = 30_000;

export interface GpsSample extends LatLng {
  accuracyM: number | null;
  speedMps: number | null;
  recordedAtMs: number;
}

export interface LastGoodFix extends LatLng {
  recordedAtMs: number;
}

export type GpsQualityVerdict =
  | { quality: 'GOOD' }
  | { quality: 'LOW' }
  | { quality: 'REJECTED'; reason: GpsRejectReason };

/**
 * Kalite filtresi (SPEC §8). Yetki (epoch/cihaz/sefer) buraya gelmez.
 * Reddedilince son güvenilir koordinat korunur.
 */
export function evaluateGpsQuality(input: {
  nowMs: number;
  sample: GpsSample;
  lastGood: LastGoodFix | null;
}): GpsQualityVerdict {
  const recordedAge = input.nowMs - input.sample.recordedAtMs;
  if (recordedAge > GPS_STALE_RECORDED_MS) {
    return { quality: 'REJECTED', reason: 'STALE_RECORDED_AT' };
  }
  if (input.sample.recordedAtMs - input.nowMs > GPS_FUTURE_SKEW_MS) {
    return { quality: 'REJECTED', reason: 'FUTURE_RECORDED_AT' };
  }
  if (input.sample.accuracyM !== null && input.sample.accuracyM > GPS_ACCURACY_REJECT_M) {
    return { quality: 'REJECTED', reason: 'ACCURACY' };
  }
  if (input.sample.speedMps !== null && input.sample.speedMps > GPS_MAX_SPEED_MPS) {
    return { quality: 'REJECTED', reason: 'IMPOSSIBLE_SPEED' };
  }
  if (input.lastGood) {
    if (input.sample.recordedAtMs < input.lastGood.recordedAtMs) {
      return { quality: 'REJECTED', reason: 'STALE_RECORDED_AT' };
    }
    const dtSec = Math.max(1, (input.sample.recordedAtMs - input.lastGood.recordedAtMs) / 1000);
    const distance = haversineMeters(input.lastGood, input.sample);
    const implied = distance / dtSec;
    if (distance >= GPS_JUMP_REJECT_M && implied > GPS_MAX_SPEED_MPS) {
      return { quality: 'REJECTED', reason: 'JUMP' };
    }
    if (implied > GPS_MAX_SPEED_MPS) {
      return { quality: 'REJECTED', reason: 'IMPOSSIBLE_SPEED' };
    }
  }
  if (input.sample.accuracyM !== null && input.sample.accuracyM > GPS_ACCURACY_LOW_M) {
    return { quality: 'LOW' };
  }
  return { quality: 'GOOD' };
}

export function shouldArchivePing(lastArchiveAtMs: number | null, nowMs: number): boolean {
  if (lastArchiveAtMs === null) return true;
  return nowMs - lastArchiveAtMs >= PING_ARCHIVE_INTERVAL_MS;
}

export function gpsRejectMessage(reason: GpsRejectReason): string {
  switch (reason) {
    case 'ACCURACY':
      return 'Konum doğruluğu yetersiz';
    case 'IMPOSSIBLE_SPEED':
      return 'İmkânsız hız değişimi';
    case 'JUMP':
      return 'Ani konum sıçraması reddedildi';
    case 'STALE_RECORDED_AT':
      return 'Konum kaydı çok eski';
    case 'FUTURE_RECORDED_AT':
      return 'Konum kaydı gelecek zamanlı';
    default:
      return exhaustive(reason, 'gpsRejectMessage');
  }
}

export function gpsAuthMessage(reason: GpsAuthReason): string {
  switch (reason) {
    case 'WRONG_TRIP':
      return 'Konum bu sefere ait değil';
    case 'WRONG_EPOCH':
      return 'Eski cihaz oturumu; konum düşürüldü';
    case 'WRONG_DEVICE':
      return 'Bu cihaz canlı konum kaynağı değil';
    case 'DEVICE_REVOKED':
      return 'Bu cihaz iptal edilmiş';
    case 'TRIP_NOT_ACTIVE':
      return 'Sefer aktif değil';
    case 'GPS_KILLED':
      return 'Konum toplama kapalı';
    default:
      return exhaustive(reason, 'gpsAuthMessage');
  }
}
