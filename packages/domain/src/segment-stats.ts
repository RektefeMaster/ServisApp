/**
 * Rota segmentinin öğrenilmiş süre istatistiği.
 *
 * Önceki sürüm "median" kolonuna akan ortalamayı, "p75" kolonuna ise gördüğü en
 * büyük değeri yazıyordu. Tek kötü sefer (kaza, yol kapanması) p75'i kalıcı
 * olarak zehirliyor, medyan da ortalamadan farksız kalıyordu. Bunun yerine son
 * N ölçüm saklanır ve gerçek yüzdelikler bu pencereden hesaplanır: pencere
 * sınırlı olduğu için hem uç değer eriyip gider hem de satır büyümez.
 */
export const SEGMENT_SAMPLE_WINDOW = 32;

export interface SegmentStatSummary {
  avgSeconds: number;
  medianSeconds: number;
  p75Seconds: number;
}

/** Yeni ölçümü pencereye ekler; en eski ölçüm düşer. */
export function appendSegmentSample(
  samples: readonly number[],
  actualSeconds: number,
  window = SEGMENT_SAMPLE_WINDOW,
): number[] {
  const clean = samples.filter((value) => Number.isFinite(value) && value > 0).map(Math.round);
  const next = [...clean, Math.max(1, Math.round(actualSeconds))];
  return next.length > window ? next.slice(next.length - window) : next;
}

export function quantile(samples: readonly number[], p: number): number | null {
  const sorted = [...samples].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0] ?? null;
  // Doğrusal ara değerleme (R-7): küçük örneklemde tek gözlemi uca yapıştırmaz.
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower];
  const high = sorted[upper];
  if (low === undefined || high === undefined) return null;
  if (lower === upper) return low;
  return Math.round(low + (high - low) * (position - lower));
}

export function summarizeSegmentSamples(samples: readonly number[]): SegmentStatSummary | null {
  const clean = samples.filter((value) => Number.isFinite(value) && value > 0);
  if (clean.length === 0) return null;
  const total = clean.reduce((sum, value) => sum + value, 0);
  const median = quantile(clean, 0.5);
  const p75 = quantile(clean, 0.75);
  if (median === null || p75 === null) return null;
  return {
    avgSeconds: Math.max(1, Math.round(total / clean.length)),
    medianSeconds: Math.max(1, Math.round(median)),
    p75Seconds: Math.max(1, Math.round(p75)),
  };
}

/**
 * Segmentin hangi trafik dilimine düştüğü, kiracının yerel saatiyle belirlenir.
 * UTC saatiyle kovalamak "sabah 07:00 servisi" verisini 04:00 kovasına yazardı;
 * çok saat dilimli kurulumda da diliminler birbirine karışırdı.
 */
export function localTimeBucket(at: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(at);
  const weekdayName = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hourText = parts.find((part) => part.type === 'hour')?.value ?? '0';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = Math.max(0, weekdays.indexOf(weekdayName));
  const hour = Number(hourText) % 24;
  return { weekday, hour: Number.isFinite(hour) ? hour : 0 };
}
