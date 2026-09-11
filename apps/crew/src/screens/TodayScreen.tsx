import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, space } from '@servisapp/ui';
import { resumeOpenTrip, ymdInTimeZone, type TripState } from '@servisapp/domain';
import type { TripSummary } from '@servisapp/contracts';
import { ApiError, listTrips, type CrewSession } from '../api/client';
import { loadLastTripId } from '../auth';
import { formatClock, segmentLabel, tripStateLabel } from '../format';

export function TodayScreen({
  session,
  onOpenTrip,
  onLogout,
  onSessionInvalid,
}: {
  session: CrewSession;
  onOpenTrip: (tripId: string) => void;
  onLogout: () => void;
  onSessionInvalid: () => void;
}) {
  const [items, setItems] = useState<TripSummary[]>([]);
  const [resume, setResume] = useState<{ id: string; reason: 'ACTIVE' | 'LAST_OPEN' } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const date = ymdInTimeZone(new Date(), 'Europe/Istanbul');

  const reload = useCallback(async () => {
    setError(null);
    try {
      const trips = await listTrips(session, date);
      setItems(trips);
      const last = await loadLastTripId();
      setResume(
        resumeOpenTrip(
          trips.map((trip) => ({ id: trip.id, state: trip.state as TripState })),
          last,
        ),
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionInvalid();
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Seferler alınamadı');
    } finally {
      setLoading(false);
    }
  }, [date, onSessionInvalid, session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
    >
      <Text style={styles.hello}>{session.fullName}</Text>
      <Text style={styles.date}>{date}</Text>
      {resume ? (
        <Pressable onPress={() => onOpenTrip(resume.id)} style={styles.resume}>
          <Text style={styles.resumeEyebrow}>
            {resume.reason === 'ACTIVE' ? 'DEVAM EDEN SEFER' : 'SON AÇILAN'}
          </Text>
          <Text style={styles.resumeBody}>Uygulama kapansa da sefer durmadı. Devam et.</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading && items.length === 0 ? <ActivityIndicator color={colors.headlamp} /> : null}
      {items.map((trip) => (
        <Pressable key={trip.id} onPress={() => onOpenTrip(trip.id)} style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.plate}>{trip.plate}</Text>
            <Text style={styles.badge}>{tripStateLabel(trip.state)}</Text>
          </View>
          <Text style={styles.school}>{trip.schoolName}</Text>
          <Text style={styles.meta}>
            {segmentLabel(trip.segment)} · {formatClock(trip.plannedDepartureAt)}
          </Text>
        </Pressable>
      ))}
      {!loading && items.length === 0 && !error ? (
        <Text style={styles.empty}>Bugün atanmış sefer yok.</Text>
      ) : null}
      <Pressable onPress={onLogout} style={styles.logout}>
        <Text style={styles.logoutText}>Çıkış</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.asphalt },
  content: { padding: space.lg, paddingTop: 56, gap: space.md },
  hello: { color: colors.paper, fontSize: 28, fontWeight: '800' },
  date: { color: colors.muted, fontSize: 16, marginBottom: space.sm },
  resume: {
    backgroundColor: colors.headlamp,
    borderRadius: 16,
    padding: space.md,
  },
  resumeEyebrow: { color: colors.asphalt, fontWeight: '800', letterSpacing: 1 },
  resumeBody: { color: colors.asphalt, marginTop: 4, fontSize: 16 },
  error: { color: colors.danger },
  card: {
    backgroundColor: colors.steel,
    borderRadius: 16,
    padding: space.md,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plate: { color: colors.headlamp, fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  badge: { color: colors.paper, fontWeight: '700' },
  school: { color: colors.paper, fontSize: 18, marginTop: 6 },
  meta: { color: colors.muted, marginTop: 4 },
  empty: { color: colors.muted, fontSize: 16 },
  logout: { alignSelf: 'flex-start', paddingVertical: space.md },
  logoutText: { color: colors.muted, fontSize: 16 },
});
