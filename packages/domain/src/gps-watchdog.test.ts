import { describe, expect, it } from 'vitest';
import {
  gpsWatchdog,
  gpsWatchdogCrewMessage,
  gpsWatchdogParentMessage,
  liveLocationAvailable,
} from './gps-watchdog.js';

describe('gpsWatchdog', () => {
  it('30 sn altını canlı sayar', () => {
    expect(gpsWatchdog(0)).toBe('LIVE');
    expect(gpsWatchdog(29_999)).toBe('LIVE');
    expect(liveLocationAvailable('LIVE', false)).toBe(true);
  });

  it('30–60 sn arası stale’dir ve personele uyarı verir', () => {
    expect(gpsWatchdog(45_000)).toBe('STALE');
    expect(gpsWatchdogCrewMessage('STALE')).toMatch(/kontrol/i);
    expect(gpsWatchdogParentMessage('STALE')).toBeNull();
    expect(liveLocationAvailable('STALE', false)).toBe(false);
  });

  it('60 sn–3 dk arası cihaz uyarısını sürdürür; veliye 3 dk mesajı yok', () => {
    expect(gpsWatchdog(90_000)).toBe('DEVICE_WARN');
    expect(gpsWatchdogCrewMessage('DEVICE_WARN')).toMatch(/kontrol/i);
    expect(gpsWatchdogParentMessage('DEVICE_WARN')).toBeNull();
    expect(liveLocationAvailable('DEVICE_WARN', false)).toBe(false);
  });

  it('3 dk sonra veliye canlı konum göstermez', () => {
    expect(gpsWatchdog(181_000)).toBe('UNAVAILABLE');
    expect(gpsWatchdogParentMessage('UNAVAILABLE')).toMatch(/güncellenemiyor/);
    expect(liveLocationAvailable('UNAVAILABLE', false)).toBe(false);
  });

  it('reddedilmiş kalitede canlı göstermez', () => {
    expect(liveLocationAvailable('LIVE', true)).toBe(false);
  });
});
