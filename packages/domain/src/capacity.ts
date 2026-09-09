/**
 * Kapasite kontrolü koltuk sayısıyla öğrenci sayısını karşılaştırmak DEĞİLDİR.
 *
 * Sabah rotasında 45 öğrenci atanmış olabilir ama bazıları okuldan önce inerse
 * araçta aynı anda hiç 38'i geçmeyebilir; akşam rotasında ise herkes okulda
 * bindiği için zirve ilk durakta oluşur. Naif bir COUNT(*) hem yasal aktarımı
 * reddeder hem de dolu aracı kabul eder (SPEC §13).
 */
export interface StopOccupancyChange {
  seq: number;
  boarding: number;
  alighting: number;
}

export function peakOccupancy(stops: readonly StopOccupancyChange[]): number {
  let current = 0;
  let peak = 0;
  for (const stop of [...stops].sort((a, b) => a.seq - b.seq)) {
    // Bir durakta önce inilir, sonra binilir: koltuk boşalmadan dolmaz.
    current -= stop.alighting;
    current += stop.boarding;
    if (current > peak) peak = current;
  }
  return peak;
}

export type CapacityCheck =
  { ok: true; peak: number } | { ok: false; peak: number; seatCount: number };

export function checkCapacity(
  stops: readonly StopOccupancyChange[],
  seatCount: number,
): CapacityCheck {
  const peak = peakOccupancy(stops);
  return peak <= seatCount ? { ok: true, peak } : { ok: false, peak, seatCount };
}
