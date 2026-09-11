import { describe, expect, it, vi } from 'vitest';
import { computeGoogleRouteBaseline, durationSec, parseLegs } from './google-routes.js';

const points = [
  { id: 'a', lat: 40.9713, lng: 29.0756 },
  { id: 'b', lat: 40.98, lng: 29.05 },
  { id: 'c', lat: 40.9876, lng: 29.0264 },
];

describe('durationSec', () => {
  it('Google süre biçimlerini okur', () => {
    expect(durationSec('123s')).toBe(123);
    expect(durationSec({ seconds: '90' })).toBe(90);
    expect(durationSec(12.6)).toBe(13);
  });
});

describe('parseLegs', () => {
  it('bacak sayısı durak sayısından bir eksik olmalı', () => {
    expect(
      parseLegs(points, {
        routes: [{ legs: [{ duration: '60s', distanceMeters: 100 }] }],
      }),
    ).toBeNull();
    const legs = parseLegs(points, {
      routes: [
        {
          legs: [
            { duration: '60s', distanceMeters: 400 },
            { duration: { seconds: '90' }, distanceMeters: 500 },
          ],
        },
      ],
    });
    expect(legs).toEqual([
      { fromStopId: 'a', toStopId: 'b', durationSec: 60, distanceM: 400 },
      { fromStopId: 'b', toStopId: 'c', durationSec: 90, distanceM: 500 },
    ]);
  });
});

describe('computeGoogleRouteBaseline', () => {
  it('anahtar yoksa çağrı yapmaz', async () => {
    const fetchImpl = vi.fn();
    const result = await computeGoogleRouteBaseline(points, new Date(), {
      apiKey: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('tek parçada sequential departureTime kullanır', async () => {
    const fetchImpl = vi.fn((_url: string, _init?: { body?: string }) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            routes: [
              {
                legs: [
                  { duration: '120s', distanceMeters: 800 },
                  { duration: '180s', distanceMeters: 1100 },
                ],
              },
            ],
          }),
      }),
    );
    const startedAt = new Date('2026-09-11T04:00:00.000Z');
    const result = await computeGoogleRouteBaseline(points, startedAt, {
      apiKey: 'test-key-xx',
      now: startedAt,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result?.httpCalls).toBe(1);
    expect(result?.baseline.source).toBe('google');
    expect(result?.baseline.legs).toHaveLength(2);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      departureTime: string;
    };
    expect(body.departureTime).toBe(startedAt.toISOString());
  });

  it('ikinci parçanın kalkışını birinci varışa bağlar', async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `p${index}`,
      lat: 40.97 + index * 0.001,
      lng: 29.07,
    }));
    const startedAt = new Date('2026-09-11T04:00:00.000Z');
    const departures: string[] = [];
    const fetchImpl = vi.fn((_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body)) as {
        departureTime: string;
        intermediates?: unknown[];
      };
      departures.push(body.departureTime);
      const legCount = (body.intermediates?.length ?? 0) + 1;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            routes: [
              {
                legs: Array.from({ length: legCount }, () => ({
                  duration: '10s',
                  distanceMeters: 50,
                })),
              },
            ],
          }),
      });
    });
    const result = await computeGoogleRouteBaseline(many, startedAt, {
      apiKey: 'test-key-xx',
      now: startedAt,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result?.httpCalls).toBe(2);
    expect(result?.baseline.legs).toHaveLength(39);
    expect(departures[0]).toBe(startedAt.toISOString());
    expect(departures[1]).toBe(new Date(startedAt.getTime() + 26 * 10 * 1000).toISOString());
  });

  it('HTTP hatasında haversine’e düşmek için null döner', async () => {
    const result = await computeGoogleRouteBaseline(points, new Date(), {
      apiKey: 'test-key-xx',
      fetchImpl: (() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });
});
