import { describe, expect, it } from 'vitest';
import { pickStudentAnchorStop } from './student-anchor.js';

const moda = { kind: 'PICKUP' as const, lat: 40.987, lng: 29.025 };
const caferaga = { kind: 'PICKUP' as const, lat: 40.981, lng: 29.026 };
const school = { kind: 'SCHOOL' as const, lat: 40.99, lng: 29.03 };
const lastDrop = { kind: 'DROPOFF' as const, lat: 40.96, lng: 29.08 };

describe('transfer durak eşleşmesi', () => {
  it('sabah öğrencinin evine en yakın PICKUP durağını seçer, ilk durağı değil', () => {
    const home = { lat: 40.9811, lng: 29.0261 };
    expect(pickStudentAnchorStop([moda, caferaga, school], home, 'MORNING', 1500)).toEqual(
      caferaga,
    );
  });

  it('akşam ilk PICKUP değil son DROPOFF havuzundan evine yakın olanı seçer', () => {
    const home = { lat: 40.9601, lng: 29.0801 };
    expect(
      pickStudentAnchorStop([school, moda, lastDrop], home, 'AFTERNOON', 1500),
    ).toEqual(lastDrop);
  });

  it('adres yoksa sessizce ilk durağa düşmez; eşik uzak durağı keser', () => {
    expect(pickStudentAnchorStop([moda, school], null, 'MORNING')).toBeNull();
    expect(
      pickStudentAnchorStop([moda, school], { lat: 41.1, lng: 29.2 }, 'MORNING', 1500),
    ).toBeNull();
    expect(pickStudentAnchorStop([moda, school], { lat: 41.1, lng: 29.2 }, 'MORNING')).toEqual(
      moda,
    );
  });
});
