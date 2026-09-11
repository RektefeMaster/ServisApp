import { describe, expect, it } from 'vitest';
import { checkCapacity, countsTowardCapacity, peakOccupancy } from './capacity.js';

describe('kapasite — anlık zirve doluluk', () => {
  it('akşam rotasında zirve ilk durakta oluşur', () => {
    const stops = [
      { seq: 1, boarding: 40, alighting: 0 },
      { seq: 2, boarding: 0, alighting: 10 },
      { seq: 3, boarding: 0, alighting: 30 },
    ];
    expect(peakOccupancy(stops)).toBe(40);
  });

  it('erken inişler sayesinde 45 öğrenci 40 koltuğa sığabilir', () => {
    const stops = [
      { seq: 1, boarding: 20, alighting: 0 },
      { seq: 2, boarding: 15, alighting: 10 },
      { seq: 3, boarding: 10, alighting: 5 },
    ];
    // Toplam 45 öğrenci ama araçta aynı anda en çok 30 kişi var.
    expect(peakOccupancy(stops)).toBe(30);
    expect(checkCapacity(stops, 30)).toEqual({ ok: true, peak: 30 });
  });

  it('naif toplam sayım yerine zirveyi kullanır — yasal aktarımı reddetmez', () => {
    const stops = [
      { seq: 1, boarding: 17, alighting: 0 },
      { seq: 2, boarding: 1, alighting: 1 },
    ];
    expect(checkCapacity(stops, 17)).toEqual({ ok: true, peak: 17 });
  });

  it('kapasiteyi aşan aktarımı reddeder', () => {
    const stops = [{ seq: 1, boarding: 18, alighting: 0 }];
    expect(checkCapacity(stops, 17)).toEqual({ ok: false, peak: 18, seatCount: 17 });
  });

  it('durak sırası karışık gelse de doğru hesaplar', () => {
    const stops = [
      { seq: 3, boarding: 0, alighting: 30 },
      { seq: 1, boarding: 40, alighting: 0 },
      { seq: 2, boarding: 0, alighting: 10 },
    ];
    expect(peakOccupancy(stops)).toBe(40);
  });

  it('fazla iniş sonraki biniş zirvesini gizlemez', () => {
    const stops = [
      { seq: 1, boarding: 0, alighting: 8 },
      { seq: 2, boarding: 18, alighting: 0 },
    ];
    expect(peakOccupancy(stops)).toBe(18);
    expect(checkCapacity(stops, 17)).toEqual({ ok: false, peak: 18, seatCount: 17 });
  });

  it('teslim ve taşınmış öğrenciyi koltuk hesabına katmaz', () => {
    expect(countsTowardCapacity('EXPECTED')).toBe(true);
    expect(countsTowardCapacity('ON_BOARD')).toBe(true);
    expect(countsTowardCapacity('DELIVERY_FAILED')).toBe(true);
    expect(countsTowardCapacity('DELIVERED')).toBe(false);
    expect(countsTowardCapacity('MOVED_OUT')).toBe(false);
    expect(countsTowardCapacity('ABSENT_PLANNED')).toBe(true);
    expect(countsTowardCapacity('NO_SHOW')).toBe(true);
  });
});
