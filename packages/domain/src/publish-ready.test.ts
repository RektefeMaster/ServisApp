import { describe, expect, it } from 'vitest';
import { hasUsableCoordinates, tripReadyCrewBlock } from './publish-ready.js';

describe('yayın ve sefer READY', () => {
  it('sıfır koordinatı güvenilir saymaz', () => {
    expect(hasUsableCoordinates(0, 0)).toBe(false);
    expect(hasUsableCoordinates(40.99, 29.03)).toBe(true);
  });

  it('şoför eksiğini yayın değil READY bloğu olarak işaretler', () => {
    expect(
      tripReadyCrewBlock({
        driverMembershipId: null,
        attendantMembershipId: null,
        attendantRequired: false,
      }),
    ).toBe('DRIVER_MISSING');
  });

  it('hostes zorunlu okulda hostes yoksa READY olmaz', () => {
    expect(
      tripReadyCrewBlock({
        driverMembershipId: 'drv',
        attendantMembershipId: null,
        attendantRequired: true,
      }),
    ).toBe('ATTENDANT_MISSING');
  });
});
