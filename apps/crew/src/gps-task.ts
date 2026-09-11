import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { loadStoredSession } from './auth';
import { loadGpsContext, sendGpsSample } from './gps-send';

export const TRIP_GPS_TASK = 'servisapp-crew-trip-gps';

TaskManager.defineTask(TRIP_GPS_TASK, async ({ data, error }) => {
  if (error) return;
  const payload = data as { locations?: Location.LocationObject[] } | undefined;
  const position = payload?.locations?.at(-1);
  if (!position) return;
  const session = await loadStoredSession();
  const context = await loadGpsContext();
  if (!session || !context) {
    await Location.stopLocationUpdatesAsync(TRIP_GPS_TASK).catch(() => undefined);
    return;
  }
  try {
    const result = await sendGpsSample(session, position, context.tripId, context.sessionEpoch);
    if (result === 'stopped') {
      await Location.stopLocationUpdatesAsync(TRIP_GPS_TASK).catch(() => undefined);
    }
  } catch {
    // Arka plan görevi seferi durdurmaz; bir sonraki ping dener.
  }
});

export async function startBackgroundTripGps(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(TRIP_GPS_TASK).catch(() => false);
  if (started) return;
  await Location.startLocationUpdatesAsync(TRIP_GPS_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 8_000,
    distanceInterval: 12,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'ServisApp sefer',
      notificationBody: 'Canlı konum gönderiliyor',
    },
  });
}

export async function stopBackgroundTripGps(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(TRIP_GPS_TASK).catch(() => false);
  if (started) {
    await Location.stopLocationUpdatesAsync(TRIP_GPS_TASK).catch(() => undefined);
  }
}
