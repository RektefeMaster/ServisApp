export const TRIP_HORIZON_DAYS = 7;
/** Rota kendi kalkış saatini taşımıyorsa düşülen varsayılan (yalnız geriye dönük veri). */
export const MORNING_DEPARTURE_HOUR = 7;
export const AFTERNOON_DEPARTURE_HOUR = 16;

const LOCAL_TIME_PATTERN = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

export type HorizonSegment = 'MORNING' | 'AFTERNOON';

/**
 * Servis günü kiracı saat dilimindeki takvim günüdür; cihaz saatinden
 * türetilmez (SPEC §7). Ufuk bugün dahil 7 gündür.
 */
export function ymdInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: 'numeric',
  }).format(instant);
}

export function horizonServiceDates(
  now: Date,
  timeZone: string,
  days = TRIP_HORIZON_DAYS,
): string[] {
  return horizonDatesFrom(ymdInTimeZone(now, timeZone), days);
}

/** Takvim gününden ileri sayar; saat dilimine yeniden çevirmez. */
export function horizonDatesFrom(fromYmd: string, days = TRIP_HORIZON_DAYS): string[] {
  if (days < 1) return [];
  return Array.from({ length: days }, (_, index) => addDaysYmd(fromYmd, index));
}

function addDaysYmd(ymd: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`geçersiz servis günü: ${ymd}`);
  const at = new Date(`${ymd}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) throw new Error(`geçersiz servis günü: ${ymd}`);
  at.setUTCDate(at.getUTCDate() + days);
  const next = at.toISOString().slice(0, 10);
  if (!next) throw new Error(`geçersiz servis günü: ${ymd}`);
  return next;
}

/**
 * Bir servis şirketinde her rota aynı dakikada çıkmaz: ikinci vardiya 06:30,
 * uzak mahalle 07:10 kalkar. Kalkış saati rotanın kendi alanıdır; segment
 * varsayılanı yalnız alan doldurulmamışsa devreye girer.
 */
export function defaultDepartureLocalTime(segment: HorizonSegment): string {
  const hour = segment === 'MORNING' ? MORNING_DEPARTURE_HOUR : AFTERNOON_DEPARTURE_HOUR;
  return `${String(hour).padStart(2, '0')}:00`;
}

/** "07:00" / "07:00:00" → "07:00". Geçersiz değerde segment varsayılanına düşer. */
export function normalizeDepartureLocalTime(
  value: string | null | undefined,
  segment: HorizonSegment,
): string {
  const trimmed = (value ?? '').trim().slice(0, 5);
  return LOCAL_TIME_PATTERN.test(trimmed) ? trimmed : defaultDepartureLocalTime(segment);
}

export function plannedDepartureAt(
  serviceDate: string,
  segment: HorizonSegment,
  timeZone: string,
  departureLocalTime?: string | null,
): Date {
  const local = normalizeDepartureLocalTime(departureLocalTime, segment);
  const [hour, minute] = local.split(':');
  return instantFromZonedLocal(serviceDate, Number(hour), Number(minute), timeZone);
}

export function deliveryTargetForSegment(segment: HorizonSegment): 'SCHOOL' | 'HOME' {
  return segment === 'MORNING' ? 'SCHOOL' : 'HOME';
}

export function expectedStopKind(segment: HorizonSegment): 'PICKUP' | 'DROPOFF' {
  return segment === 'MORNING' ? 'PICKUP' : 'DROPOFF';
}

export function zonedDayStart(ymd: string, timeZone: string): Date {
  return instantFromZonedLocal(ymd, 0, 0, timeZone);
}

export function zonedDayEnd(ymd: string, timeZone: string): Date {
  return instantFromZonedLocal(addDaysYmd(ymd, 1), 0, 0, timeZone);
}

function instantFromZonedLocal(ymd: string, hour: number, minute: number, timeZone: string): Date {
  const padded = `${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
  const naiveUtc = Date.parse(padded);
  if (Number.isNaN(naiveUtc)) {
    throw new Error(`geçersiz servis günü: ${ymd}`);
  }
  const first = new Date(naiveUtc - tzOffsetMs(new Date(naiveUtc), timeZone));
  return new Date(naiveUtc - tzOffsetMs(first, timeZone));
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
      hour: 'numeric',
    })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])?(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes) * 60_000;
}
