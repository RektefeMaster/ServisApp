import { describe, expect, it } from 'vitest';
import {
  SEGMENT_SAMPLE_WINDOW,
  appendSegmentSample,
  localTimeBucket,
  quantile,
  summarizeSegmentSamples,
} from './segment-stats.js';

describe('segment istatistiği', () => {
  it('medyan ortalamadan farklıdır', () => {
    const summary = summarizeSegmentSamples([100, 105, 110, 115, 600]);
    expect(summary?.medianSeconds).toBe(110);
    expect(summary?.avgSeconds).toBe(206);
  });

  it('p75 gördüğü en büyük değer değildir', () => {
    const summary = summarizeSegmentSamples([100, 105, 110, 115, 600]);
    expect(summary?.p75Seconds).toBe(115);
    expect(summary?.p75Seconds).toBeLessThan(600);
  });

  it('tek kötü sefer pencereden düşünce etkisi kaybolur', () => {
    let samples = [600];
    for (let i = 0; i < SEGMENT_SAMPLE_WINDOW; i += 1) {
      samples = appendSegmentSample(samples, 100);
    }
    expect(samples).toHaveLength(SEGMENT_SAMPLE_WINDOW);
    expect(samples).not.toContain(600);
    expect(summarizeSegmentSamples(samples)?.p75Seconds).toBe(100);
  });

  it('pencere dolana kadar bütün ölçümleri tutar', () => {
    expect(appendSegmentSample([], 120)).toEqual([120]);
    expect(appendSegmentSample([120], 130)).toEqual([120, 130]);
  });

  it('bozuk ve sıfır ölçümleri eler', () => {
    expect(appendSegmentSample([0, Number.NaN, 90], 110)).toEqual([90, 110]);
    expect(summarizeSegmentSamples([])).toBeNull();
    expect(quantile([], 0.5)).toBeNull();
  });

  it('tek ölçümde medyan da p75 de o ölçümdür', () => {
    expect(summarizeSegmentSamples([240])).toEqual({
      avgSeconds: 240,
      medianSeconds: 240,
      p75Seconds: 240,
    });
  });

  it('trafik dilimi kiracının yerel saatinden okunur', () => {
    // 2026-09-10T04:00:00Z = İstanbul'da Perşembe 07:00.
    const bucket = localTimeBucket(new Date('2026-09-10T04:00:00.000Z'), 'Europe/Istanbul');
    expect(bucket).toEqual({ weekday: 4, hour: 7 });
    expect(localTimeBucket(new Date('2026-09-10T04:00:00.000Z'), 'UTC')).toEqual({
      weekday: 4,
      hour: 4,
    });
  });

  it('yerel gece yarısı 0 saatine düşer', () => {
    expect(localTimeBucket(new Date('2026-09-09T21:00:00.000Z'), 'Europe/Istanbul')).toEqual({
      weekday: 4,
      hour: 0,
    });
  });
});
