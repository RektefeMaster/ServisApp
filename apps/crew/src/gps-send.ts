import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as Location from 'expo-location';
import type { LocationIngestResult } from '@servisapp/contracts';
import { ApiError, postLocation, type CrewSession } from './api/client';

export const PING_INTERVAL_MS = 8_000;
const LAST_SENT_KEY = 'crew.gps.lastSentAt';
const CONTEXT_KEY = 'crew.gps.context';
const LAST_ACCEPTED_KEY = 'crew.gps.lastAcceptedAt';

export interface GpsContext {
  tripId: string;
  sessionEpoch: number;
}

export async function persistGpsContext(context: GpsContext): Promise<void> {
  await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
}

export async function loadGpsContext(): Promise<GpsContext | null> {
  const raw = await AsyncStorage.getItem(CONTEXT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GpsContext;
    if (typeof parsed.tripId !== 'string') return null;
    return { tripId: parsed.tripId, sessionEpoch: Number(parsed.sessionEpoch) || 0 };
  } catch {
    return null;
  }
}

export async function clearGpsContext(): Promise<void> {
  await AsyncStorage.multiRemove([CONTEXT_KEY, LAST_SENT_KEY, LAST_ACCEPTED_KEY]);
}

export async function loadLastAcceptedAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(LAST_ACCEPTED_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function sendGpsSample(
  session: CrewSession,
  position: Location.LocationObject,
  tripId: string,
  sessionEpoch: number,
): Promise<LocationIngestResult | 'throttled' | 'stopped'> {
  const now = Date.now();
  const lastRaw = await AsyncStorage.getItem(LAST_SENT_KEY);
  const lastSent = lastRaw ? Number(lastRaw) : 0;
  if (Number.isFinite(lastSent) && now - lastSent < PING_INTERVAL_MS - 500) {
    return 'throttled';
  }
  await AsyncStorage.setItem(LAST_SENT_KEY, String(now));
  const coords = position.coords;
  try {
    const result = await postLocation(session, tripId, {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracyM: coords.accuracy,
      speedMps: coords.speed != null && coords.speed >= 0 ? coords.speed : null,
      heading: coords.heading != null && coords.heading >= 0 ? coords.heading : null,
      recordedAt: new Date(position.timestamp).toISOString(),
      sessionEpoch,
    });
    await persistGpsContext({ tripId, sessionEpoch: result.sessionEpoch });
    if (result.locationSourceDeviceId && result.locationSourceDeviceId !== session.deviceId) {
      return 'stopped';
    }
    if (result.trackingEnded) return 'stopped';
    if (result.accepted) {
      await AsyncStorage.setItem(LAST_ACCEPTED_KEY, String(Date.now()));
    }
    return result;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 409) return 'stopped';
    throw caught;
  }
}
