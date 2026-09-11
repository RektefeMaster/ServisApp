import {
  assembleSequentialOffsets,
  chunkRoutePoints,
  mergeChunkLegs,
  type BaselineLeg,
  type RouteBaseline,
  type RoutePoint,
} from '@servisapp/domain';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.legs.duration,routes.legs.distanceMeters';

export interface GoogleBaselineResult {
  baseline: RouteBaseline;
  httpCalls: number;
}

export async function computeGoogleRouteBaseline(
  points: readonly RoutePoint[],
  startedAt: Date,
  options: {
    apiKey?: string | null;
    now?: Date;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<GoogleBaselineResult | null> {
  const apiKey = options.apiKey ?? process.env['GOOGLE_MAPS_API_KEY'] ?? '';
  if (apiKey.length < 8 || points.length < 2) return null;
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const chunks = chunkRoutePoints(points.length);
  if (chunks.length === 0) return null;

  const parts: BaselineLeg[][] = [];
  const chunkDurationSec: number[] = [];
  let timed = chunks;
  let httpCalls = 0;

  for (let index = 0; index < timed.length; index += 1) {
    const chunk = timed[index];
    if (!chunk) return null;
    const slice = points.slice(chunk.startIndex, chunk.endIndex + 1);
    const origin = slice[0];
    const destination = slice[slice.length - 1];
    if (!origin || !destination) return null;
    const departureMs = Math.max(now.getTime(), startedAt.getTime() + chunk.departureOffsetSec * 1000);
    const legs = await requestChunk(fetchImpl, apiKey, slice, origin, destination, new Date(departureMs));
    if (!legs) return null;
    httpCalls += 1;
    parts.push(legs);
    chunkDurationSec.push(legs.reduce((sum, leg) => sum + leg.durationSec, 0));
    timed = assembleSequentialOffsets(chunks, chunkDurationSec);
  }

  return {
    httpCalls,
    baseline: {
      source: 'google',
      computedAt: now.toISOString(),
      legs: mergeChunkLegs(parts),
    },
  };
}

async function requestChunk(
  fetchImpl: typeof fetch,
  apiKey: string,
  slice: readonly RoutePoint[],
  origin: RoutePoint,
  destination: RoutePoint,
  departureTime: Date,
): Promise<BaselineLeg[] | null> {
  const intermediates = slice.slice(1, -1).map((point) => latLng(point));
  let response: Response;
  try {
    response = await fetchImpl(ROUTES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        origin: latLng(origin),
        destination: latLng(destination),
        intermediates: intermediates.length > 0 ? intermediates : undefined,
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        departureTime: departureTime.toISOString(),
        languageCode: 'tr',
      }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  return parseLegs(slice, body);
}

function latLng(point: RoutePoint): { location: { latLng: { latitude: number; longitude: number } } } {
  return {
    location: { latLng: { latitude: point.lat, longitude: point.lng } },
  };
}

export function parseLegs(points: readonly RoutePoint[], body: unknown): BaselineLeg[] | null {
  if (!body || typeof body !== 'object') return null;
  const routes = (body as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || !routes[0] || typeof routes[0] !== 'object') return null;
  const legsRaw = (routes[0] as { legs?: unknown }).legs;
  if (!Array.isArray(legsRaw) || legsRaw.length !== points.length - 1) return null;
  const legs: BaselineLeg[] = [];
  for (let i = 0; i < legsRaw.length; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const raw = legsRaw[i];
    if (!from || !to || !raw || typeof raw !== 'object') return null;
    const duration = durationSec((raw as { duration?: unknown }).duration);
    const distanceM = Number((raw as { distanceMeters?: unknown }).distanceMeters);
    if (duration === null || !Number.isFinite(distanceM) || distanceM < 0) return null;
    legs.push({
      fromStopId: from.id,
      toStopId: to.id,
      durationSec: Math.max(1, duration),
      distanceM,
    });
  }
  return legs;
}

export function durationSec(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') {
    const match = /^([0-9.]+)s$/.exec(value.trim());
    if (match?.[1]) return Math.max(1, Math.round(Number(match[1])));
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(1, Math.round(numeric)) : null;
  }
  if (value && typeof value === 'object' && 'seconds' in value) {
    const numeric = Number((value as { seconds: unknown }).seconds);
    return Number.isFinite(numeric) ? Math.max(1, Math.round(numeric)) : null;
  }
  return null;
}
