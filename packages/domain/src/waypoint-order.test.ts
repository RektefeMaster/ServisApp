import { describe, expect, it } from 'vitest';
import { haversineMeters } from './haversine.js';
import { suggestWaypointOrder, type Waypoint } from './waypoint-order.js';

const school: Waypoint = { id: 'okul', lat: 40.99, lng: 29.03 };

function stop(id: string, lng: number): Waypoint {
  return { id, lat: 40.99, lng };
}

describe('haversine', () => {
  it('aynı nokta sıfırdır', () => {
    expect(haversineMeters(school, school)).toBe(0);
  });

  it('Kadıköy–Moda ölçeğinde yüzlerce metre üretir', () => {
    const moda = { lat: 40.9876, lng: 29.0264 };
    const meters = haversineMeters(school, moda);
    expect(meters).toBeGreaterThan(200);
    expect(meters).toBeLessThan(2_000);
  });
});

describe('durak sırası önerisi', () => {
  it('sabah en uzaktan okula doğru toplar', () => {
    const a = stop('a', 29.04);
    const b = stop('b', 29.05);
    const c = stop('c', 29.06);
    expect(
      suggestWaypointOrder({
        school,
        stops: [a, c, b],
        schoolAnchor: 'end',
      }),
    ).toEqual(['c', 'b', 'a', 'okul']);
  });

  it('akşam okuldan en yakına bırakır', () => {
    expect(
      suggestWaypointOrder({
        school,
        stops: [stop('b', 29.05), stop('a', 29.04)],
        schoolAnchor: 'start',
      }),
    ).toEqual(['okul', 'a', 'b']);
  });

  it('2-opt son durak-okul kenarını maliyetler', () => {
    const localSchool: Waypoint = { id: 'okul', lat: 0, lng: 0 };
    const far: Waypoint = { id: 'far', lat: 0, lng: 10 };
    const mid: Waypoint = { id: 'mid', lat: 1, lng: 9 };
    const near: Waypoint = { id: 'near', lat: 0, lng: 1 };
    const order = suggestWaypointOrder({
      school: localSchool,
      stops: [near, mid, far],
      schoolAnchor: 'end',
    });
    expect(order.at(-1)).toBe('okul');
    expect(order.at(-2)).toBe('near');
  });

  it('çapraz gidişi 2-opt ile kısaltır', () => {
    const crossed = [
      { id: 'nw', lat: 41.02, lng: 29.0 },
      { id: 'se', lat: 40.96, lng: 29.08 },
      { id: 'ne', lat: 41.02, lng: 29.08 },
      { id: 'sw', lat: 40.96, lng: 29.0 },
    ];
    const order = suggestWaypointOrder({
      school,
      stops: crossed,
      schoolAnchor: 'end',
    });
    expect(order.at(-1)).toBe('okul');
    expect(pathLength(order, [school, ...crossed])).toBeLessThan(
      pathLength(['nw', 'se', 'ne', 'sw', 'okul'], [school, ...crossed]),
    );
  });

  it('okul kimliğini ve tekrarlayan durakları yutar', () => {
    expect(
      suggestWaypointOrder({
        school,
        stops: [],
        schoolAnchor: 'end',
      }),
    ).toEqual(['okul']);
    expect(
      suggestWaypointOrder({
        school,
        stops: [school, stop('a', 29.04), stop('a', 29.04)],
        schoolAnchor: 'end',
      }),
    ).toEqual(['a', 'okul']);
  });
});

function pathLength(ids: string[], points: Waypoint[]): number {
  const byId = new Map(points.map((point) => [point.id, point]));
  let total = 0;
  for (let i = 0; i < ids.length - 1; i += 1) {
    const from = byId.get(ids[i] ?? '');
    const to = byId.get(ids[i + 1] ?? '');
    if (!from || !to) throw new Error('eksik nokta');
    total += haversineMeters(from, to);
  }
  return total;
}
