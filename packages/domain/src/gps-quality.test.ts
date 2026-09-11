import { describe, expect, it } from 'vitest';
import {
  GPS_ACCURACY_REJECT_M,
  GPS_JUMP_REJECT_M,
  evaluateGpsQuality,
  gpsRejectMessage,
  shouldArchivePing,
} from './gps-quality.js';

const now = Date.parse('2026-09-11T04:00:00.000Z');

describe('evaluateGpsQuality', () => {
  it('iyi örneği GOOD sayar', () => {
    expect(
      evaluateGpsQuality({
        nowMs: now,
        sample: {
          lat: 40.98,
          lng: 29.03,
          accuracyM: 12,
          speedMps: 8,
          recordedAtMs: now - 2_000,
        },
        lastGood: null,
      }),
    ).toEqual({ quality: 'GOOD' });
  });

  it('accuracy eşiğini reddeder', () => {
    const verdict = evaluateGpsQuality({
      nowMs: now,
      sample: {
        lat: 40.98,
        lng: 29.03,
        accuracyM: GPS_ACCURACY_REJECT_M + 1,
        speedMps: 3,
        recordedAtMs: now - 1_000,
      },
      lastGood: null,
    });
    expect(verdict).toEqual({ quality: 'REJECTED', reason: 'ACCURACY' });
    if (verdict.quality === 'REJECTED') {
      expect(gpsRejectMessage(verdict.reason)).toMatch(/doğruluğu/i);
    }
  });

  it('orta accuracy LOW işaretler', () => {
    expect(
      evaluateGpsQuality({
        nowMs: now,
        sample: {
          lat: 40.98,
          lng: 29.03,
          accuracyM: 55,
          speedMps: 4,
          recordedAtMs: now - 1_000,
        },
        lastGood: null,
      }).quality,
    ).toBe('LOW');
  });

  it('eski recorded_at reddedilir', () => {
    expect(
      evaluateGpsQuality({
        nowMs: now,
        sample: {
          lat: 40.98,
          lng: 29.03,
          accuracyM: 8,
          speedMps: 4,
          recordedAtMs: now - 90_000,
        },
        lastGood: null,
      }),
    ).toEqual({ quality: 'REJECTED', reason: 'STALE_RECORDED_AT' });
  });

  it('gelecek recorded_at reddedilir', () => {
    expect(
      evaluateGpsQuality({
        nowMs: now,
        sample: {
          lat: 40.98,
          lng: 29.03,
          accuracyM: 8,
          speedMps: 4,
          recordedAtMs: now + 30_000,
        },
        lastGood: null,
      }),
    ).toEqual({ quality: 'REJECTED', reason: 'FUTURE_RECORDED_AT' });
  });

  it('5 saniyede yüzlerce metrelik sıçramayı reddeder', () => {
    const last = { lat: 40.98, lng: 29.03, recordedAtMs: now - 5_000 };
    const jumped = {
      lat: last.lat + GPS_JUMP_REJECT_M / 111_000,
      lng: last.lng,
      accuracyM: 8,
      speedMps: 5,
      recordedAtMs: now,
    };
    expect(
      evaluateGpsQuality({ nowMs: now, sample: jumped, lastGood: last }),
    ).toMatchObject({ quality: 'REJECTED', reason: 'JUMP' });
  });

  it('10 dakikada 500 m ilerlemeyi kabul eder', () => {
    const last = { lat: 40.98, lng: 29.03, recordedAtMs: now - 600_000 };
    expect(
      evaluateGpsQuality({
        nowMs: now,
        sample: {
          lat: 40.984,
          lng: 29.03,
          accuracyM: 10,
          speedMps: 8,
          recordedAtMs: now - 1_000,
        },
        lastGood: last,
      }).quality,
    ).toBe('GOOD');
  });

  it('ardışık milisaniye jitterını hız diye reddetmez', () => {
    const last = { lat: 40.98, lng: 29.03, recordedAtMs: now - 50 };
    expect(
      evaluateGpsQuality({
        nowMs: now,
        sample: {
          lat: 40.98001,
          lng: 29.03,
          accuracyM: 10,
          speedMps: 4,
          recordedAtMs: now,
        },
        lastGood: last,
      }).quality,
    ).toBe('GOOD');
  });
});

describe('shouldArchivePing', () => {
  it('30 sn dolmadan arşivlemez', () => {
    expect(shouldArchivePing(now, now + 10_000)).toBe(false);
    expect(shouldArchivePing(null, now)).toBe(true);
    expect(shouldArchivePing(now, now + 30_000)).toBe(true);
  });
});
