import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { TripDetail } from '@servisapp/contracts';
import { gpsWatchdog, gpsWatchdogCrewMessage, type GpsWatchdogState } from '@servisapp/domain';
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

  const tripId = detail?.id ?? null;
  const tripState = detail?.state ?? null;

  useEffect(() => {
    // detail henüz yüklenmediyse HİÇBİR ŞEYE dokunma. Uygulama sefer ortasında
    // öldürülüp yeniden açıldığında arka plan konumu akmaya devam ediyor;
    // "bilinmiyor" hâlini "sefer aktif değil" sayıp kapatmak, tünelde yeniden
    // yüklenemeyen bir ekranda canlı takibi kalıcı olarak öldürüyordu.
    if (tripId === null || tripState === null) return;
    if (tripState !== 'ACTIVE') {
      setMessage(null);
      void stopBackgroundTripGps();
      void clearGpsContext();
      return;
    }
    stoppedRef.current = false;
    let backgroundAllowed = false;
    let subscription: Location.LocationSubscription | null = null;
    let watchdogTimer: ReturnType<typeof setInterval> | undefined;
    void persistGpsContext({ tripId, sessionEpoch: epochRef.current });

    function stop(reason: string): void {
      stoppedRef.current = true;
      setMessage(reason);
      subscription?.remove();
      subscription = null;
      // Bekçi de durur. Yoksa 30 saniye sonra "Konum alınamıyor" yazıp gerçek
      // sebebi (örn. canlı konumu başka cihaz devraldı) ekrandan siliyordu;
      // şoför kenara çekip sapasağlam konum servisini kurcalıyordu.
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = undefined;
      }
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
      if (next === 'active') {
        void refreshWatchdog();
        // Uygulama öndeyken `watchPositionAsync` zaten akıyor; arka plan görevi
        // de sürerse aynı sefer için iki bağımsız konum akışı olur. Şoförün
        // navigasyon için de kullandığı telefonda bu tur boyunca ana pil
        // maliyetidir.
        void stopBackgroundTripGps();
        return;
      }
      if (backgroundAllowed) void startBackgroundTripGps().catch(() => undefined);
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
        if (permission.status !== Location.PermissionStatus.GRANTED) {
          stop('Konum izni gerekli');
          return;
        }
        const background = await Location.requestBackgroundPermissionsAsync();
        backgroundAllowed = background.status === Location.PermissionStatus.GRANTED;
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
  }, [tripId, tripState, session]);

  return { message };
}
