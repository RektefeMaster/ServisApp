import { describe, expect, it } from 'vitest';
import {
  blendSegmentSeconds,
  delayFactor,
  etaConfidence,
  etaWithinHorizon,
  formatParentEta,
  MAX_ETA_SECONDS,
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

  it('ufka kırpılmış değeri süre diye yazmaz', () => {
    // Araç rotanın yüzlerce km dışında bir koordinat bildirdiğinde hesap
    // MAX_ETA_SECONDS'a kırpılıyor ve güven puanı yüksek kalıyordu; ekranda
    // "Yaklaşık 720 dk" çıkıyordu.
    expect(formatParentEta({ etaSeconds: MAX_ETA_SECONDS, confidence: 0.75 })).toBeNull();
    expect(etaWithinHorizon(MAX_ETA_SECONDS)).toBe(false);
    expect(etaWithinHorizon(MAX_ETA_SECONDS - 1)).toBe(true);
    expect(etaWithinHorizon(Number.NaN)).toBe(false);
    expect(etaWithinHorizon(0)).toBe(false);
  });
});

describe('shouldNotifyApproach', () => {
  it("eşiği aşağı geçtiği ping'te bildirir; bir ping geciktirmez", () => {
    expect(
      shouldNotifyApproach({
        etaSeconds: 290,
        previousEtaSeconds: 360,
        approachNotifiedAt: null,
      }),
    ).toBe(true);
  });

  it('eşiğin altında kalmaya devam ederken tekrar bildirmez', () => {
    expect(
      shouldNotifyApproach({
        etaSeconds: 200,
        previousEtaSeconds: 240,
        approachNotifiedAt: null,
      }),
    ).toBe(false);
  });

  it('ilk ölçüm zaten eşiğin altındaysa bekletmez', () => {
    expect(
      shouldNotifyApproach({
        etaSeconds: 200,
        previousEtaSeconds: null,
        approachNotifiedAt: null,
      }),
    ).toBe(true);
  });

  it('bir kez bildirildikten sonra dalgalanma spam etmez', () => {
    expect(
      shouldNotifyApproach({
        etaSeconds: 290,
        previousEtaSeconds: 420,
        approachNotifiedAt: '2026-09-11T04:01:00.000Z',
      }),
    ).toBe(false);
  });

  it('eşiğin üstündeyken bildirmez', () => {
    expect(
      shouldNotifyApproach({
        etaSeconds: 420,
        previousEtaSeconds: 200,
        approachNotifiedAt: null,
      }),
    ).toBe(false);
  });
});

describe('remainingEtaSeconds rota ilerleyişi', () => {
  const stops = [
    { id: 's1', seq: 1, lat: 40.98, lng: 29.03 },
    { id: 's2', seq: 2, lat: 40.99, lng: 29.03 },
    { id: 's8', seq: 8, lat: 40.982, lng: 29.031 },
  ];

  it("geçilmiş durağa fiziksel yakınlık ETA'yı geri sarmaz", () => {
    // Araç s8'e giderken yol kıvrıldığı için geometrik olarak s1'e çok yakın.
    const vehicle = { lat: 40.9801, lng: 29.0301 };
    const withoutProgress = remainingEtaSeconds({
      vehicle,
      stops,
      targetStopId: 's8',
      legs: [],
      observed: [],
    });
    const withProgress = remainingEtaSeconds({
      vehicle,
      stops,
      targetStopId: 's8',
      legs: [],
      observed: [],
      lastArrivedSeq: 2,
    });
    expect(withProgress).toBeLessThan(withoutProgress);
  });

  it('hedef çoktan geçilmişse doğrudan hedefe bakar', () => {
    const eta = remainingEtaSeconds({
      vehicle: { lat: 40.9801, lng: 29.0301 },
      stops,
      targetStopId: 's1',
      legs: [],
      observed: [],
      lastArrivedSeq: 8,
    });
    expect(eta).toBeGreaterThan(0);
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

describe('ETA sonluluk güvencesi', () => {
  const stops = [
    { id: 'a', seq: 1, lat: 40.98, lng: 29.03 },
    { id: 'b', seq: 2, lat: 40.99, lng: 29.04 },
  ];

  it('bozuk koordinat NaN yerine geçerli bir saniye döner', () => {
    const eta = remainingEtaSeconds({
      vehicle: { lat: Number.NaN, lng: Number.NaN },
      stops,
      targetStopId: 'b',
      legs: [],
      observed: [],
    });
    expect(Number.isInteger(eta)).toBe(true);
    expect(eta).toBeGreaterThan(0);
  });

  it('sonuç üst sınırla kapaklanır', () => {
    const eta = remainingEtaSeconds({
      vehicle: { lat: -80, lng: -170 },
      stops,
      targetStopId: 'b',
      legs: [],
      observed: [],
    });
    expect(eta).toBeLessThanOrEqual(MAX_ETA_SECONDS);
  });
});
