import { describe, expect, it } from 'vitest';
import {
  blendSegmentSeconds,
  delayFactor,
  etaConfidence,
  formatParentEta,
  remainingEtaSeconds,
  shouldNotifyApproach,
} from './eta.js';

const stops = [
  { id: 'home', seq: 1, lat: 40.98, lng: 29.03 },
  { id: 'mid', seq: 2, lat: 40.985, lng: 29.035 },
  { id: 'school', seq: 3, lat: 40.99, lng: 29.04 },
];

const legs = [
  { fromStopId: 'home', toStopId: 'mid', durationSec: 300, distanceM: 800 },
  { fromStopId: 'mid', toStopId: 'school', durationSec: 420, distanceM: 1100 },
];

describe('blendSegmentSeconds', () => {
  it('örnek azken baseline’ı korur', () => {
    expect(blendSegmentSeconds(300, 2, 480)).toBe(300);
  });

  it('yeterli örnekte geçmiş medyana ağırlık verir', () => {
    const blended = blendSegmentSeconds(300, 30, 480);
    expect(blended).toBeGreaterThan(300);
    expect(blended).toBeLessThan(480);
  });
});

describe('delayFactor', () => {
  it('gözlem yokken 1 döner', () => {
    expect(delayFactor(legs, [])).toBe(1);
  });

  it('yakın geçmişe daha çok ağırlık verir', () => {
    const slow = delayFactor(legs, [
      { fromStopId: 'home', toStopId: 'mid', actualDurationSec: 300 },
      { fromStopId: 'mid', toStopId: 'school', actualDurationSec: 840 },
    ]);
    expect(slow).toBeGreaterThan(1.3);
  });
});

describe('remainingEtaSeconds', () => {
  it('hedef durağa kalan süreyi hesaplar', () => {
    const eta = remainingEtaSeconds({
      vehicle: { lat: 40.98, lng: 29.03 },
      stops,
      targetStopId: 'school',
      legs,
      observed: [],
    });
    expect(eta).toBeGreaterThan(400);
  });
});

describe('formatParentEta', () => {
  it('saniye göstermez', () => {
    expect(formatParentEta({ etaSeconds: 207, confidence: 0.9 })).toBe('Yaklaşık 3 dk');
    expect(formatParentEta({ etaSeconds: 90, confidence: 0.9 })).toBe('Yaklaşıyor');
    expect(formatParentEta({ etaSeconds: 240, confidence: 0.2 })).toBe('Yaklaşıyor');
  });
});

describe('shouldNotifyApproach', () => {
  it('tek ölçümle tetiklenmez', () => {
    expect(
      shouldNotifyApproach({
        etaSeconds: 200,
        previousEtaSeconds: null,
        approachNotifiedAt: null,
      }),
    ).toBe(false);
  });

  it('iki ardışık eşikte bir kez tetikler', () => {
    expect(
      shouldNotifyApproach({
        etaSeconds: 200,
        previousEtaSeconds: 240,
        approachNotifiedAt: null,
      }),
    ).toBe(true);
    expect(
      shouldNotifyApproach({
        etaSeconds: 200,
        previousEtaSeconds: 240,
        approachNotifiedAt: '2026-09-11T04:01:00.000Z',
      }),
    ).toBe(false);
  });

  it('5→7→5 dalgalanmasında spam etmez', () => {
    expect(
      shouldNotifyApproach({
        etaSeconds: 300,
        previousEtaSeconds: 420,
        approachNotifiedAt: null,
      }),
    ).toBe(false);
  });
});

describe('etaConfidence', () => {
  it('baseline yokken düşük kalır', () => {
    expect(
      etaConfidence({
        gpsAgeMs: 5_000,
        accuracyM: 8,
        offRouteM: 10,
        hasBaseline: false,
        delayFactor: 1,
      }),
    ).toBe(0.3);
  });
});
