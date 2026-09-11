import { describe, expect, it } from 'vitest';
import { MemoryRealtimeTransport, REALTIME_HISTORY_CAP } from './memory.js';

const sample = {
  vehicleLat: 40.98,
  vehicleLng: 29.03,
  heading: 90,
  recordedAt: '2026-09-11T04:10:00.000+00:00',
  quality: 'GOOD' as const,
};

describe('MemoryRealtimeTransport', () => {
  it('sefer başına yayın geçmişini tavanlar', () => {
    const realtime = new MemoryRealtimeTransport();
    for (let i = 0; i < REALTIME_HISTORY_CAP + 20; i += 1) {
      realtime.publishVehicle('trip-a', { ...sample, heading: i });
    }
    const list = realtime.vehicleBroadcasts('trip-a');
    expect(list).toHaveLength(REALTIME_HISTORY_CAP);
    expect(list[0]?.payload.heading).toBe(20);
    expect(list.at(-1)?.payload.heading).toBe(REALTIME_HISTORY_CAP + 19);
  });

  it('seferler birbirinin geçmişini ezmez', () => {
    const realtime = new MemoryRealtimeTransport();
    realtime.publishVehicle('a', sample);
    realtime.publishVehicle('b', { ...sample, heading: 1 });
    expect(realtime.vehicleBroadcasts('a')).toHaveLength(1);
    expect(realtime.vehicleBroadcasts('b')).toHaveLength(1);
  });
});
