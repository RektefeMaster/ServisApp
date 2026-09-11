import type { LatLng } from './haversine.js';

/** İstemci animasyonu yeni konum değildir; backend'e yazılmaz. */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export function interpolateLngLat(from: LatLng, to: LatLng, t: number): LatLng {
  const e = easeInOutCubic(t);
  return {
    lat: from.lat + (to.lat - from.lat) * e,
    lng: from.lng + (to.lng - from.lng) * e,
  };
}
