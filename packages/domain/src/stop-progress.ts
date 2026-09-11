import { haversineMeters, type LatLng } from './haversine.js';

export const STOP_ARRIVAL_RADIUS_M = 75;
/** Araç bir sonraki durağa yaklaştıysa önceki kaçırılmış sayılır. */
export const STOP_MISS_ADVANCE_M = 120;
/** Kaçırılmış saymak için araçtan önceki durağa minimum uzaklık. */
export const STOP_MISS_LEAVE_M = 200;

export interface ProgressStop {
  id: string;
  seq: number;
  lat: number;
  lng: number;
  arrivedAt: Date | null;
}

export type StopArrivalKind = 'ARRIVED' | 'MISSED';

export interface StopArrivalMark {
  stopId: string;
  kind: StopArrivalKind;
}

/**
 * Monoton ilerleme: sıradaki durağa girilince ARRIVED;
 * araç çoktan geçmişse ve sonraki durağa yaklaştıysa önceki MISSED.
 */
export function planStopArrivals(
  stops: readonly ProgressStop[],
  vehicle: LatLng,
  options: {
    arrivalRadiusM?: number;
    missAdvanceM?: number;
    missLeaveM?: number;
  } = {},
): StopArrivalMark[] {
  const arrivalRadius = options.arrivalRadiusM ?? STOP_ARRIVAL_RADIUS_M;
  const missAdvance = options.missAdvanceM ?? STOP_MISS_ADVANCE_M;
  const missLeave = options.missLeaveM ?? STOP_MISS_LEAVE_M;
  const pending = stops
    .filter((stop) => !stop.arrivedAt)
    .slice()
    .sort((left, right) => left.seq - right.seq);
  if (pending.length === 0) return [];

  const marks: StopArrivalMark[] = [];
  for (let i = 0; i < pending.length; i += 1) {
    const current = pending[i];
    if (!current) continue;
    const distance = haversineMeters(vehicle, { lat: current.lat, lng: current.lng });
    if (distance <= arrivalRadius) {
      marks.push({ stopId: current.id, kind: 'ARRIVED' });
      break;
    }
    const next = pending[i + 1];
    if (!next) break;
    const nextDistance = haversineMeters(vehicle, { lat: next.lat, lng: next.lng });
    // Yoğun rotada önceki <200m olsa bile sonraki ARRIVAL yarıçapındaysa kaçırılmış say.
    if (nextDistance <= arrivalRadius || (distance >= missLeave && nextDistance <= missAdvance)) {
      marks.push({ stopId: current.id, kind: 'MISSED' });
      continue;
    }
    break;
  }
  return marks;
}
