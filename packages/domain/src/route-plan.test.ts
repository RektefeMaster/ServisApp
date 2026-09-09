import { describe, expect, it } from 'vitest';
import {
  evaluateRouteCapacity,
  evaluateRoutePlan,
  occupancyForSegment,
  type RoutePlanStop,
} from './route-plan.js';

function morning(): RoutePlanStop[] {
  return [
    { stopId: 'home-a', seq: 1, kind: 'PICKUP', studentIds: ['efe'] },
    { stopId: 'home-b', seq: 2, kind: 'PICKUP', studentIds: ['ada', 'can'] },
    { stopId: 'okul', seq: 3, kind: 'SCHOOL', studentIds: [] },
  ];
}

describe('rota planı — yayın kuralları', () => {
  it('geçerli sabah rotasını kabul eder', () => {
    expect(evaluateRoutePlan('MORNING', morning())).toEqual({ ok: true });
  });

  it('geçerli akşam rotasını kabul eder', () => {
    const stops: RoutePlanStop[] = [
      { stopId: 'okul', seq: 1, kind: 'SCHOOL', studentIds: [] },
      { stopId: 'home-a', seq: 2, kind: 'DROPOFF', studentIds: ['efe'] },
    ];
    expect(evaluateRoutePlan('AFTERNOON', stops)).toEqual({ ok: true });
  });

  it('okulsuz rotayı reddeder', () => {
    const stops: RoutePlanStop[] = [
      { stopId: 'home-a', seq: 1, kind: 'PICKUP', studentIds: ['efe'] },
    ];
    expect(evaluateRoutePlan('MORNING', stops)).toEqual({
      ok: false,
      issue: { code: 'MISSING_SCHOOL_STOP' },
    });
  });

  it('okulu sabah sonda, akşam başta ister', () => {
    const schoolFirst: RoutePlanStop[] = [
      { stopId: 'okul', seq: 1, kind: 'SCHOOL', studentIds: [] },
      { stopId: 'home-a', seq: 2, kind: 'PICKUP', studentIds: ['efe'] },
    ];
    expect(evaluateRoutePlan('MORNING', schoolFirst)).toMatchObject({
      ok: false,
      issue: { code: 'SCHOOL_POSITION', expected: 'end' },
    });

    const schoolLast: RoutePlanStop[] = [
      { stopId: 'home-a', seq: 1, kind: 'DROPOFF', studentIds: ['efe'] },
      { stopId: 'okul', seq: 2, kind: 'SCHOOL', studentIds: [] },
    ];
    expect(evaluateRoutePlan('AFTERNOON', schoolLast)).toMatchObject({
      ok: false,
      issue: { code: 'SCHOOL_POSITION', expected: 'start' },
    });
  });

  it('sabah bırakma, akşam alma durağını reddeder', () => {
    const morningDrop: RoutePlanStop[] = [
      { stopId: 'home-a', seq: 1, kind: 'DROPOFF', studentIds: ['efe'] },
      { stopId: 'okul', seq: 2, kind: 'SCHOOL', studentIds: [] },
    ];
    expect(evaluateRoutePlan('MORNING', morningDrop)).toMatchObject({
      ok: false,
      issue: { code: 'WRONG_KIND_FOR_SEGMENT', kind: 'DROPOFF' },
    });
  });

  it('öğrencisiz ev durağını ve çift öğrenciyi reddeder', () => {
    expect(
      evaluateRoutePlan('MORNING', [
        { stopId: 'home-a', seq: 1, kind: 'PICKUP', studentIds: [] },
        { stopId: 'okul', seq: 2, kind: 'SCHOOL', studentIds: [] },
      ]),
    ).toMatchObject({ ok: false, issue: { code: 'PASSENGER_STOP_EMPTY', seq: 1 } });

    expect(
      evaluateRoutePlan('MORNING', [
        { stopId: 'home-a', seq: 1, kind: 'PICKUP', studentIds: ['efe'] },
        { stopId: 'home-b', seq: 2, kind: 'PICKUP', studentIds: ['efe'] },
        { stopId: 'okul', seq: 3, kind: 'SCHOOL', studentIds: [] },
      ]),
    ).toMatchObject({ ok: false, issue: { code: 'DUPLICATE_STUDENT', studentId: 'efe' } });
  });

  it('seq boşluklarını ve aynı durağı iki kez reddeder', () => {
    expect(
      evaluateRoutePlan('MORNING', [
        { stopId: 'home-a', seq: 1, kind: 'PICKUP', studentIds: ['efe'] },
        { stopId: 'okul', seq: 3, kind: 'SCHOOL', studentIds: [] },
      ]),
    ).toMatchObject({ ok: false, issue: { code: 'INVALID_SEQUENCE' } });

    expect(
      evaluateRoutePlan('MORNING', [
        { stopId: 'home-a', seq: 1, kind: 'PICKUP', studentIds: ['efe'] },
        { stopId: 'home-a', seq: 2, kind: 'PICKUP', studentIds: ['ada'] },
        { stopId: 'okul', seq: 3, kind: 'SCHOOL', studentIds: [] },
      ]),
    ).toMatchObject({ ok: false, issue: { code: 'DUPLICATE_STOP' } });
  });

  it('boş rota, çift okul ve okul durağındaki öğrenciyi reddeder', () => {
    expect(evaluateRoutePlan('MORNING', [])).toEqual({
      ok: false,
      issue: { code: 'EMPTY_ROUTE' },
    });
    expect(
      evaluateRoutePlan('MORNING', [
        { stopId: 'okul-a', seq: 1, kind: 'SCHOOL', studentIds: [] },
        { stopId: 'okul-b', seq: 2, kind: 'SCHOOL', studentIds: [] },
      ]),
    ).toMatchObject({ ok: false, issue: { code: 'MULTIPLE_SCHOOL_STOPS' } });
    expect(
      evaluateRoutePlan('MORNING', [
        { stopId: 'home-a', seq: 1, kind: 'PICKUP', studentIds: ['efe'] },
        { stopId: 'okul', seq: 2, kind: 'SCHOOL', studentIds: ['efe'] },
      ]),
    ).toMatchObject({ ok: false, issue: { code: 'STUDENT_ON_SCHOOL_STOP' } });
  });
});

describe('rota planı — zirve doluluk', () => {
  it('sabah okulda herkesi indirir', () => {
    expect(occupancyForSegment('MORNING', morning())).toEqual([
      { seq: 1, boarding: 1, alighting: 0 },
      { seq: 2, boarding: 2, alighting: 0 },
      { seq: 3, boarding: 0, alighting: 3 },
    ]);
    expect(evaluateRouteCapacity('MORNING', morning(), 3)).toEqual({ ok: true, peak: 3 });
    expect(evaluateRouteCapacity('MORNING', morning(), 2)).toEqual({
      ok: false,
      peak: 3,
      seatCount: 2,
    });
  });

  it('akşam zirveyi okulda oluşturur', () => {
    const stops: RoutePlanStop[] = [
      { stopId: 'okul', seq: 1, kind: 'SCHOOL', studentIds: [] },
      { stopId: 'a', seq: 2, kind: 'DROPOFF', studentIds: ['efe'] },
      { stopId: 'b', seq: 3, kind: 'DROPOFF', studentIds: ['ada', 'can'] },
    ];
    expect(evaluateRouteCapacity('AFTERNOON', stops, 3)).toEqual({ ok: true, peak: 3 });
  });

  it('karışık seq gelse de zirveyi seq sırasıyla hesaplar', () => {
    const shuffled: RoutePlanStop[] = [
      { stopId: 'okul', seq: 3, kind: 'SCHOOL', studentIds: [] },
      { stopId: 'home-a', seq: 1, kind: 'PICKUP', studentIds: ['efe'] },
      { stopId: 'home-b', seq: 2, kind: 'PICKUP', studentIds: ['ada', 'can'] },
    ];
    expect(occupancyForSegment('MORNING', shuffled)).toEqual([
      { seq: 1, boarding: 1, alighting: 0 },
      { seq: 2, boarding: 2, alighting: 0 },
      { seq: 3, boarding: 0, alighting: 3 },
    ]);
    expect(evaluateRouteCapacity('MORNING', shuffled, 3)).toEqual({ ok: true, peak: 3 });
  });
});
