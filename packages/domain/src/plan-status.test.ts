import { describe, expect, it } from 'vitest';
import { segmentPlanStatus } from './plan-status.js';

describe('segment plan durumu', () => {
  it('bilinçli servis yokluğunu hazırlanıyor sanmaz', () => {
    expect(
      segmentPlanStatus({
        studentEnded: false,
        studentSuspended: false,
        usesSegment: false,
        publishedAssignment: false,
        stopHasCoordinates: false,
      }),
    ).toBe('NO_SERVICE');
  });

  it('yayınlı durak ve koordinat varsa READY döner', () => {
    expect(
      segmentPlanStatus({
        studentEnded: false,
        studentSuspended: false,
        usesSegment: true,
        publishedAssignment: true,
        stopHasCoordinates: true,
      }),
    ).toBe('READY');
  });

  it('beklenen segment atamasızsa PREPARING döner', () => {
    expect(
      segmentPlanStatus({
        studentEnded: false,
        studentSuspended: false,
        usesSegment: true,
        publishedAssignment: false,
        stopHasCoordinates: false,
      }),
    ).toBe('PREPARING');
  });

  it('askıya alınmış öğrenciyi SUSPENDED gösterir', () => {
    expect(
      segmentPlanStatus({
        studentEnded: false,
        studentSuspended: true,
        usesSegment: true,
        publishedAssignment: true,
        stopHasCoordinates: true,
      }),
    ).toBe('SUSPENDED');
  });
});
