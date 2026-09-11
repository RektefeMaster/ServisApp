import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { TripDetail } from '@servisapp/contracts';
import {
  gpsWatchdog,
  gpsWatchdogCrewMessage,
  type GpsWatchdogState,
} from '@servisapp/domain';
import * as Location from 'expo-location';
import { fetchConfig, type CrewSession } from './api/client';
import {
  PING_INTERVAL_MS,
  clearGpsContext,
  loadLastAcceptedAt,
  persistGpsContext,
  sendGpsSample,
} from './gps-send';
import { startBackgroundTripGps, stopBackgroundTripGps } from './gps-task';

export function useTripGps(
  session: CrewSession,
  detail: TripDetail | null,
): { message: string | null } {
  const [message, setMessage] = useState<string | null>(null);
  const epochRef = useRef(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    epochRef.current = detail?.locationSessionEpoch ?? 0;
  }, [detail?.locationSessionEpoch]);

  useEffect(() => {
    if (!detail || detail.state !== 'ACTIVE') {
      setMessage(null);
      void stopBackgroundTripGps();
      void clearGpsContext();
      return;
    }
    const tripId = detail.id;
    stoppedRef.current = false;
    let subscription: Location.LocationSubscription | null = null;
    let watchdogTimer: ReturnType<typeof setInterval> | undefined;
    void persistGpsContext({ tripId, sessionEpoch: epochRef.current });

    function stop(reason: string): void {
      stoppedRef.current = true;
      setMessage(reason);
      subscription?.remove();
      subscription = null;
      void stopBackgroundTripGps();
    }

    async function refreshWatchdog(): Promise<void> {
      const ageAt = await loadLastAcceptedAt();
      const age = ageAt ? Date.now() - ageAt : null;
      const state: GpsWatchdogState = gpsWatchdog(age);
      const warn = gpsWatchdogCrewMessage(state);
      if (warn) setMessage(warn);
    }

    function onAppState(next: AppStateStatus): void {
      if (next === 'active') void refreshWatchdog();
    }

    const appSub = AppState.addEventListener('change', onAppState);

    void (async () => {
      try {
        const platform = await fetchConfig();
        if (platform.kills.gps) {
          stop('Konum toplama kapalı');
          return;
        }
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          stop('Konum izni gerekli');
          return;
        }
        const background = await Location.requestBackgroundPermissionsAsync();
        if (background.status === 'granted') {
          await startBackgroundTripGps().catch(() => undefined);
        }
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: PING_INTERVAL_MS,
            distanceInterval: 12,
          },
          (position) => {
            if (stoppedRef.current) return;
            void sendGpsSample(session, position, tripId, epochRef.current)
              .then((result) => {
                if (result === 'throttled') return;
                if (result === 'stopped') {
                  stop('Canlı konum durdu');
                  return;
                }
                epochRef.current = result.sessionEpoch;
                if (result.accepted) {
                  setMessage(null);
                  return;
                }
                setMessage(result.reason ?? 'Konum reddedildi');
              })
              .catch(() => {
                setMessage('Konum gönderilemedi');
              });
          },
        );
        watchdogTimer = setInterval(() => {
          void refreshWatchdog();
        }, 5_000);
      } catch {
        stop('Konum servisi açılamadı');
      }
    })();

    return () => {
      stoppedRef.current = true;
      subscription?.remove();
      if (watchdogTimer) clearInterval(watchdogTimer);
      appSub.remove();
      void stopBackgroundTripGps();
    };
  }, [detail?.id, detail?.state, session]);

  return { message };
}
