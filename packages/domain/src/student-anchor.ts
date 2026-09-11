import { haversineMeters, type LatLng } from './haversine.js';
import type { StopKind } from './route-plan.js';
import { expectedStopKind, type HorizonSegment } from './trip-horizon.js';

export interface StudentAnchorStop extends LatLng {
  kind: StopKind;
}

/**
 * Transfer / MOVED_IN öğrencisini rotanın ilk/son durağına oturtmak yanlış
 * adrese bırakır. Eşleşme: öğrencinin adresi ↔ hedef rotadaki doğru tür durak.
 * `maxDetourM` verilirse evinden o kadar uzak durak reddedilir; transferde
 * yönetici rotayı seçtiği için eşik uygulanmaz, yine de tür havuzu şarttır.
 */
export function pickStudentAnchorStop<T extends StudentAnchorStop>(
  stops: readonly T[],
  home: LatLng | null,
  segment: HorizonSegment,
  maxDetourM = Number.POSITIVE_INFINITY,
): T | null {
  if (!home) return null;
  const want = expectedStopKind(segment);
  const pool = stops.filter((stop) => stop.kind === want);
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stop of pool) {
    const distance = haversineMeters(home, stop);
    if (distance < bestDistance) {
      best = stop;
      bestDistance = distance;
    }
  }
  if (!best || bestDistance > maxDetourM) return null;
  return best;
}
