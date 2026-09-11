import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ParentTrackingView } from '@servisapp/contracts';
import { colors, space } from '@servisapp/ui';
import { ApiError, fetchTracking, type ParentSession } from '../api/client';
import { PrivacyMap } from '../components/PrivacyMap';

const POLL_MS = 12_000;

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

  const reload = useCallback(async () => {
    try {
      const next = await fetchTracking(session, tripId, studentId);
      setView(next);
      setError(null);
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

  return (
    <View style={styles.screen}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← Ana ekran</Text>
      </Pressable>
      <Text style={styles.name}>{studentName}</Text>
      {ended ? (
        <Text style={styles.ended}>Canlı takip kapandı</Text>
      ) : (
        <>
          <PrivacyMap vehicle={view?.vehicle ?? null} ownStop={view?.ownStop ?? null} />
          <Text style={styles.eta}>{view?.etaText ?? 'ETA hesaplanıyor'}</Text>
          {view?.staleMessage ? <Text style={styles.stale}>{view.staleMessage}</Text> : null}
          {view?.approaching ? <Text style={styles.approach}>Yaklaşıyor</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!view && !error ? <ActivityIndicator color={colors.headlamp} /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.asphalt, padding: space.lg, paddingTop: 56 },
  back: { color: colors.headlamp, fontSize: 16, marginBottom: space.sm },
  name: { color: colors.paper, fontSize: 28, fontWeight: '800', marginBottom: space.md },
  eta: { color: colors.paper, fontSize: 22, fontWeight: '700' },
  stale: { color: colors.headlamp, marginTop: space.sm },
  approach: { color: colors.headlamp, marginTop: space.sm, fontWeight: '800' },
  ended: { color: colors.muted, fontSize: 18, marginTop: space.lg },
  error: { color: colors.danger, marginTop: space.sm },
});
