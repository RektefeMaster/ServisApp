import { exhaustive } from './exhaustive.js';

export const GPS_WATCHDOG_STATES = ['LIVE', 'STALE', 'DEVICE_WARN', 'UNAVAILABLE'] as const;
export type GpsWatchdogState = (typeof GPS_WATCHDOG_STATES)[number];

export const GPS_STALE_AFTER_MS = 30_000;
export const GPS_DEVICE_WARN_AFTER_MS = 60_000;
export const GPS_UNAVAILABLE_AFTER_MS = 180_000;

/**
 * SPEC §8 watchdog. Sefer durmaz. Eski konum canlıymış gibi gösterilmez.
 */
export function gpsWatchdog(ageMs: number | null): GpsWatchdogState {
  if (ageMs === null) return 'UNAVAILABLE';
  if (ageMs < GPS_STALE_AFTER_MS) return 'LIVE';
  if (ageMs < GPS_DEVICE_WARN_AFTER_MS) return 'STALE';
  if (ageMs < GPS_UNAVAILABLE_AFTER_MS) return 'DEVICE_WARN';
  return 'UNAVAILABLE';
}

export function gpsWatchdogCrewMessage(state: GpsWatchdogState): string | null {
  switch (state) {
    case 'LIVE':
      return null;
    case 'STALE':
    case 'DEVICE_WARN':
      return 'Konum servisini kontrol edin';
    case 'UNAVAILABLE':
      return 'Konum alınamıyor';
    default:
      return exhaustive(state, 'gpsWatchdogCrewMessage');
  }
}

export function gpsWatchdogParentMessage(state: GpsWatchdogState): string | null {
  switch (state) {
    case 'LIVE':
    case 'STALE':
    case 'DEVICE_WARN':
      return null;
    case 'UNAVAILABLE':
      return 'Canlı konum geçici olarak güncellenemiyor';
    default:
      return exhaustive(state, 'gpsWatchdogParentMessage');
  }
}

export function liveLocationAvailable(state: GpsWatchdogState, qualityRejected: boolean): boolean {
  if (qualityRejected) return false;
  return state === 'LIVE';
}
