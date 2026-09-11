import { describe, expect, it } from 'vitest';
import {
  ROUTES_MAX_POINTS_PER_REQUEST,
  assembleSequentialOffsets,
  chunkRoutePoints,
  chunkedHaversineBaseline,
  haversineBaseline,
  shouldRefreshRoutes,
} from './route-baseline.js';

describe('chunkRoutePoints', () => {
  it('≤27 noktayı tek parça yapar', () => {
    expect(chunkRoutePoints(10)).toEqual([{ startIndex: 0, endIndex: 9, departureOffsetSec: 0 }]);
    expect(chunkRoutePoints(27)[0]?.endIndex).toBe(26);
  });

  it('28+ noktayı örtüşen parçalara böler', () => {
    const chunks = chunkRoutePoints(40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.endIndex).toBe(ROUTES_MAX_POINTS_PER_REQUEST - 1);
    expect(chunks[1]?.startIndex).toBe(chunks[0]?.endIndex);
    expect(chunks.at(-1)?.endIndex).toBe(39);
  });

  it('tek nokta için parça üretmez', () => {
    expect(chunkRoutePoints(1)).toEqual([]);
  });
});

describe('assembleSequentialOffsets', () => {
  it('ikinci parçanın kalkışını birinci varışa bağlar', () => {
    const chunks = chunkRoutePoints(40);
    const timed = assembleSequentialOffsets(chunks, [2100, 900]);
    expect(timed[0]?.departureOffsetSec).toBe(0);
    expect(timed[1]?.departureOffsetSec).toBe(2100);
  });
});

describe('chunkedHaversineBaseline', () => {
  it('düz haversine ile aynı bacakları üretir', () => {
    const points = [
      { id: 'a', lat: 40.98, lng: 29.03 },
      { id: 'b', lat: 40.981, lng: 29.031 },
      { id: 'c', lat: 40.99, lng: 29.04 },
    ];
    const chunked = chunkedHaversineBaseline(points, new Date('2026-09-11T04:00:00.000Z'));
    const flat = haversineBaseline(points, new Date('2026-09-11T04:00:00.000Z'));
    expect(chunked.legs).toEqual(flat.legs);
  });
});

describe('haversineBaseline', () => {
  it('ardışık bacak üretir', () => {
    const baseline = haversineBaseline(
      [
        { id: 'a', lat: 40.98, lng: 29.03 },
        { id: 'b', lat: 40.981, lng: 29.031 },
        { id: 'c', lat: 40.99, lng: 29.04 },
      ],
      new Date('2026-09-11T04:00:00.000Z'),
    );
    expect(baseline.source).toBe('haversine');
    expect(baseline.legs).toHaveLength(2);
    expect(baseline.legs[0]?.fromStopId).toBe('a');
    expect(baseline.legs[0]?.durationSec).toBeGreaterThan(0);
  });
});

describe('shouldRefreshRoutes', () => {
  const base = {
    nowMs: 10_000_000,
    lastRoutesCallAtMs: 10_000_000 - 6 * 60_000,
    routesCallsCount: 1,
    offRouteM: null,
    unexpectedStopMs: null,
    etaConfidence: 0.8,
    routeChanged: false,
    seriousEtaMiss: false,
  };

  it('zamana göre değil olaya göre çağırır', () => {
    expect(shouldRefreshRoutes(base)).toBe(false);
    expect(shouldRefreshRoutes({ ...base, offRouteM: 450 })).toBe(true);
    expect(shouldRefreshRoutes({ ...base, routeChanged: true })).toBe(true);
    expect(shouldRefreshRoutes({ ...base, etaConfidence: 0.2 })).toBe(true);
  });

  it('5 dk guardrail ve sefer başına tavan uygular', () => {
    expect(
      shouldRefreshRoutes({
        ...base,
        lastRoutesCallAtMs: 10_000_000 - 60_000,
        offRouteM: 500,
      }),
    ).toBe(false);
    expect(
      shouldRefreshRoutes({
        ...base,
        routesCallsCount: 5,
        routeChanged: true,
      }),
    ).toBe(false);
  });
});
