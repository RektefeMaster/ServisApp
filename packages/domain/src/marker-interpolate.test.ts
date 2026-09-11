import { describe, expect, it } from 'vitest';
import { interpolateLngLat } from './marker-interpolate.js';

describe('interpolateLngLat', () => {
  it('t=0 kaynakta, t=1 hedefte kalır', () => {
    const from = { lat: 40.98, lng: 29.03 };
    const to = { lat: 40.99, lng: 29.04 };
    expect(interpolateLngLat(from, to, 0)).toEqual(from);
    expect(interpolateLngLat(from, to, 1)).toEqual(to);
  });

  it('ortada easing uygular ve backend değeri üretmez', () => {
    const early = interpolateLngLat({ lat: 0, lng: 0 }, { lat: 10, lng: 10 }, 0.25);
    expect(early.lat).toBeLessThan(2.5);
  });
});
