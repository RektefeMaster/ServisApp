import { describe, expect, it } from 'vitest';
import {
  AFTERNOON_DEPARTURE_HOUR,
  MORNING_DEPARTURE_HOUR,
  TRIP_HORIZON_DAYS,
  deliveryTargetForSegment,
  expectedStopKind,
  horizonDatesFrom,
  horizonServiceDates,
  plannedDepartureAt,
  ymdInTimeZone,
} from './trip-horizon.js';

describe('sefer ufku', () => {
  it('İstanbul gününü UTC gece yarısından doğru okur', () => {
    expect(ymdInTimeZone(new Date('2026-09-09T22:30:00.000Z'), 'Europe/Istanbul')).toBe(
      '2026-09-10',
    );
  });

  it('bugün dahil 7 gün üretir', () => {
    const dates = horizonServiceDates(new Date('2026-09-10T08:00:00+03:00'), 'Europe/Istanbul');
    expect(dates).toHaveLength(TRIP_HORIZON_DAYS);
    expect(dates[0]).toBe('2026-09-10');
    expect(dates[6]).toBe('2026-09-16');
  });

  it('sabah 07:00 ve akşam 16:00 İstanbul anına oturur', () => {
    expect(MORNING_DEPARTURE_HOUR).toBe(7);
    expect(AFTERNOON_DEPARTURE_HOUR).toBe(16);
    expect(plannedDepartureAt('2026-09-10', 'MORNING', 'Europe/Istanbul').toISOString()).toBe(
      '2026-09-10T04:00:00.000Z',
    );
    expect(plannedDepartureAt('2026-09-10', 'AFTERNOON', 'Europe/Istanbul').toISOString()).toBe(
      '2026-09-10T13:00:00.000Z',
    );
  });

  it('verilen takvim gününü saat dilimine yeniden çevirmeden sayar', () => {
    expect(horizonDatesFrom('2026-09-10', 2)).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('sabah teslim okula, akşam eve ve beklenen durak türüne bağlanır', () => {
    expect(deliveryTargetForSegment('MORNING')).toBe('SCHOOL');
    expect(deliveryTargetForSegment('AFTERNOON')).toBe('HOME');
    expect(expectedStopKind('MORNING')).toBe('PICKUP');
    expect(expectedStopKind('AFTERNOON')).toBe('DROPOFF');
  });
});
