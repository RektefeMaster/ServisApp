import { exhaustive } from './exhaustive.js';
import { haversineMeters, type LatLng } from './haversine.js';

export interface Waypoint extends LatLng {
  id: string;
}

export type SchoolAnchor = 'start' | 'end';

export type TravelCost = (from: Waypoint, to: Waypoint) => number;

/**
 * Rota kurulumunda durak sırası önerisi.
 *
 * Google Routes doldurduğu kenarlar `cost` olarak verilir; yoksa haversine.
 * Okul sabah sonda, akşam başta sabitlenir — 2-opt okulu yerinden oynatmaz.
 * (SPEC §8: ≤25 Google optimize, >25 matrix + NN + 2-opt; cache miss → haversine.)
 */
export function suggestWaypointOrder(input: {
  school: Waypoint;
  stops: readonly Waypoint[];
  schoolAnchor: SchoolAnchor;
  cost?: TravelCost;
}): string[] {
  const cost = input.cost ?? ((a, b) => haversineMeters(a, b));
  const uniqueStops: Waypoint[] = [];
  const seen = new Set<string>();
  for (const item of input.stops) {
    if (item.id === input.school.id || seen.has(item.id)) continue;
    seen.add(item.id);
    uniqueStops.push(item);
  }
  if (uniqueStops.length === 0) return [input.school.id];

  const free =
    input.schoolAnchor === 'end'
      ? nearestNeighborFarthestStart(uniqueStops, input.school, cost)
      : nearestNeighborFrom(input.school, uniqueStops, cost);
  const improved =
    input.schoolAnchor === 'end'
      ? twoOpt(free, cost, { end: input.school })
      : twoOpt(free, cost, { start: input.school });

  switch (input.schoolAnchor) {
    case 'end':
      return [...improved.map((stop) => stop.id), input.school.id];
    case 'start':
      return [input.school.id, ...improved.map((stop) => stop.id)];
    default:
      return exhaustive(input.schoolAnchor, 'schoolAnchor');
  }
}

function nearestNeighborFarthestStart(
  stops: readonly Waypoint[],
  school: Waypoint,
  cost: TravelCost,
): Waypoint[] {
  const remaining = [...stops];
  remaining.sort((a, b) => cost(b, school) - cost(a, school));
  const start = remaining.shift();
  if (!start) return [];
  return [start, ...nearestNeighborFrom(start, remaining, cost)];
}

function nearestNeighborFrom(
  origin: Waypoint,
  stops: readonly Waypoint[],
  cost: TravelCost,
): Waypoint[] {
  const remaining = [...stops];
  const ordered: Waypoint[] = [];
  let current = origin;
  while (remaining.length > 0) {
    let bestAt = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      if (!candidate) continue;
      const edge = cost(current, candidate);
      if (edge < bestCost) {
        bestCost = edge;
        bestAt = i;
      }
    }
    const next = remaining.splice(bestAt, 1)[0];
    if (!next) break;
    ordered.push(next);
    current = next;
  }
  return ordered;
}

/** Simetrik 2-opt. Okul serbest listede yoktur; start/end kenar maliyeti hesaba girer. */
function twoOpt(
  stops: Waypoint[],
  cost: TravelCost,
  pinned: { start?: Waypoint; end?: Waypoint },
): Waypoint[] {
  const order = [...stops];
  const at = (index: number): Waypoint | undefined => {
    if (index < 0) return pinned.start;
    if (index >= order.length) return pinned.end;
    return order[index];
  };
  const pairCost = (from: number, to: number): number => {
    const a = at(from);
    const b = at(to);
    if (!a || !b) return 0;
    return cost(a, b);
  };

  let improved = true;
  let passes = 0;
  const maxPasses = Math.max(8, order.length * order.length);
  while (improved && passes < maxPasses) {
    passes += 1;
    improved = false;
    for (let i = 0; i < order.length - 1; i += 1) {
      for (let k = i + 1; k < order.length; k += 1) {
        const before = pairCost(i - 1, i) + pairCost(k, k + 1);
        const after = pairCost(i - 1, k) + pairCost(i, k + 1);
        if (after + 1e-6 < before) {
          reverseRange(order, i, k);
          improved = true;
        }
      }
    }
  }
  return order;
}

function reverseRange(order: Waypoint[], from: number, to: number): void {
  const slice = order.slice(from, to + 1).reverse();
  order.splice(from, to - from + 1, ...slice);
}
