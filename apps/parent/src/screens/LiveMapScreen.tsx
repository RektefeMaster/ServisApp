import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { ParentTrackingView } from '@servisapp/contracts';
import {
  AppText,
  ETA,
  IconButton,
  InlineAlert,
  LiveProgress,
  Screen,
  colors,
  space,
  radius,
  useHardwareBack,
} from '@servisapp/ui';
import { ApiError, fetchTracking, type ParentSession } from '../api/client';
import { PrivacyMap } from '../components/PrivacyMap';
import { liveProgressSteps } from '../status';

const POLL_MS = 12_000;

function formatLastUpdated(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const clock = new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(at);
  return `Son güncelleme ${clock}`;
}

export function LiveMapScreen({
  session,
  tripId,
  studentId,
  studentName,
  onBack,
  onSessionInvalid,
}: {
  session: ParentSession;
  tripId: string;
  studentId: string;
  studentName: string;
  onBack: () => void;
  onSessionInvalid: () => void;
}) {
  const [view, setView] = useState<ParentTrackingView | null>(null);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFixAt, setLastFixAt] = useState<string | null>(null);
  useHardwareBack(onBack);

  const reload = useCallback(async () => {
    try {
      const next = await fetchTracking(session, tripId, studentId);
      setView(next);
      setError(null);
      if (next.vehicle?.recordedAt) setLastFixAt(next.vehicle.recordedAt);
      if (next.trackingEnded) setEnded(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionInvalid();
        return;
      }
      if (caught instanceof ApiError && caught.status === 410) {
        setEnded(true);
        setView(null);
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Takip güncellenemedi');
    }
  }, [onSessionInvalid, session, studentId, tripId]);

  useEffect(() => {
    void reload();
    if (ended) return;
    const timer = setInterval(() => {
      void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [ended, reload]);

  const showMap = Boolean(
    view && view.liveAvailable && view.vehicle && !view.trackingEnded && !ended,
  );

  const lastUpdated = formatLastUpdated(lastFixAt);

  const statusLine = useMemo(() => {
    if (ended || view?.trackingEnded) return 'Canlı takip kapandı';
    if (view?.approaching) return 'Durağa yaklaşıyor';
    if (view?.etaText) return 'Yolda';
    if (view && !view.liveAvailable) return 'Konum geçici olarak güncellenemiyor';
    return 'Canlı takip';
  }, [ended, view]);

  const etaDisplay = view?.etaText
    ? view.etaText
    : view && !view.liveAvailable
      ? 'Konum güncellenemiyor'
      : 'Konum alınıyor';

  const steps = useMemo(() => {
    if (!view) return [];
    return liveProgressSteps(view);
  }, [view]);

  return (
    <Screen scroll>
      <IconButton label="← Ana ekran" onPress={onBack} style={styles.back} />
      <AppText preset="title">{studentName}</AppText>

      {ended || view?.trackingEnded ? (
        <InlineAlert
          title="Canlı takip kapandı"
          body="Sefer veya teslim tamamlandı. Güncel durum ana ekranda."
          tone="info"
        />
      ) : (
        <>
          <View style={styles.hero}>
            <AppText preset="caption">YOLCULUK DURUMU</AppText>
            <ETA text={etaDisplay} size="large" />
            <AppText preset="strong" style={styles.status}>
              {statusLine}
            </AppText>
            {lastUpdated ? (
              <AppText preset="caption" color={colors.mute}>
                {lastUpdated}
              </AppText>
            ) : (
              <AppText preset="meta">Konum bekleniyor</AppText>
            )}
          </View>

          {view?.staleMessage ? <InlineAlert title={view.staleMessage} tone="warn" /> : null}

          {showMap && view ? (
            <PrivacyMap vehicle={view.vehicle} ownStop={view.ownStop} />
          ) : view && !ended ? (
            <InlineAlert
              title="Harita şu an kapalı"
              body={
                view.staleMessage ?? 'Canlı konum yokken harita gizlenir. Durum ve ETA yukarıda.'
              }
              tone="info"
            />
          ) : null}

          {steps.length > 0 ? <LiveProgress steps={steps} caption="Yolculuk akışı" /> : null}

          {error ? <InlineAlert title={error} tone="danger" /> : null}
          {!view && !error ? <ActivityIndicator color={colors.rail} style={styles.loader} /> : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: space.xs,
    paddingHorizontal: 0,
  },
  hero: {
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: space.lg,
    marginBottom: space.md,
    gap: space.xs,
  },
  status: {
    marginTop: space.xxs,
  },
  loader: {
    marginTop: space.lg,
  },
});
