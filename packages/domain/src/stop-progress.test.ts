import { describe, expect, it } from 'vitest';
import { planStopArrivals } from './stop-progress.js';

describe('planStopArrivals', () => {
  const stops = [
    { id: 's1', seq: 1, lat: 40.99, lng: 29.03, arrivedAt: null },
    { id: 's2', seq: 2, lat: 41.0, lng: 29.04, arrivedAt: null },
    { id: 's3', seq: 3, lat: 41.01, lng: 29.05, arrivedAt: null },
  ];

  it('yarıçap içindeki sıradaki durağı ARRIVED yapar', () => {
    expect(planStopArrivals(stops, { lat: 40.9901, lng: 29.0301 })).toEqual([
      { stopId: 's1', kind: 'ARRIVED' },
    ]);
  });

  it('kaçırılan durağı MISSED işaretleyip sonraki ARRIVED olabilir', () => {
    const marks = planStopArrivals(stops, { lat: 41.0, lng: 29.04 }, {
      arrivalRadiusM: 75,
      missAdvanceM: 200,
      missLeaveM: 500,
    });
    expect(marks[0]).toEqual({ stopId: 's1', kind: 'MISSED' });
    expect(marks.some((mark) => mark.stopId === 's2' && mark.kind === 'ARRIVED')).toBe(true);
  });

  it('yoğun rotada sonraki ARRIVAL yarıçapındaysa önceki MISSED olur', () => {
    // ~110 m aralık: eski missLeave=200 kuralı takılırdı; yeni kural sonraki yarıçapıyla geçer.
    const dense = [
      { id: 'a', seq: 1, lat: 40.99, lng: 29.03, arrivedAt: null },
      { id: 'b', seq: 2, lat: 40.9908, lng: 29.0308, arrivedAt: null },
    ];
    const marks = planStopArrivals(dense, { lat: 40.9908, lng: 29.0308 });
    expect(marks[0]).toEqual({ stopId: 'a', kind: 'MISSED' });
    expect(marks[1]).toEqual({ stopId: 'b', kind: 'ARRIVED' });
  });

  it('uzak bir sonraki durakta zinciri kilitlenmez diye erken dönmez', () => {
    expect(planStopArrivals(stops, { lat: 41.5, lng: 29.5 })).toEqual([]);
  });
});
