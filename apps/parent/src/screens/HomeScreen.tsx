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
import type { ParentHomeChild } from '@servisapp/contracts';
import { colors, space } from '@servisapp/ui';
import { ApiError, fetchHome, type ParentSession } from '../api/client';

export function HomeScreen({
  session,
  onOpenLive,
  onOpenChild,
  onOpenProfile,
  onLogout,
  onSessionInvalid,
}: {
  session: ParentSession;
  onOpenLive: (tripId: string, studentId: string, name: string) => void;
  onOpenChild: (studentId: string, name: string) => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  onSessionInvalid: () => void;
}) {
  const [children, setChildren] = useState<ParentHomeChild[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const home = await fetchHome(session);
      setChildren(home.children);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionInvalid();
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Ana ekran yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [onSessionInvalid, session]);

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
      <Text style={styles.lede}>Yalnız kendi çocuğunun durağı ve aracı görünür.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading && children.length === 0 ? <ActivityIndicator color={colors.headlamp} /> : null}
      {children.map((child) => {
        const live = child.live;
        return (
          <View key={child.studentId} style={styles.card}>
            <Pressable onPress={() => onOpenChild(child.studentId, child.fullName)}>
              <Text style={styles.name}>{child.fullName}</Text>
              <Text style={styles.meta}>{child.schoolName}</Text>
              {child.day?.morningAbsent || child.day?.eveningAbsent ? (
                <Text style={styles.meta}>Bugün: kısmi veya tam yokluk bildirildi</Text>
              ) : null}
              {child.day?.deliveryOverride?.otpCode ? (
                <Text style={styles.meta}>Teslim kodu: {child.day.deliveryOverride.otpCode}</Text>
              ) : null}
            </Pressable>
            {live && !live.trackingEnded ? (
              <Pressable
                onPress={() => onOpenLive(live.tripId, child.studentId, child.fullName)}
                style={styles.live}
              >
                <Text style={styles.liveEyebrow}>CANLI</Text>
                <Text style={styles.eta}>{live.etaText ?? 'Konum alınıyor'}</Text>
                {live.staleMessage ? <Text style={styles.stale}>{live.staleMessage}</Text> : null}
                <Text style={styles.open}>Haritayı aç</Text>
              </Pressable>
            ) : (
              <Text style={styles.idle}>Şu an yolda bir sefer yok</Text>
            )}
          </View>
        );
      })}
      {children.length === 0 && !loading ? (
        <Text style={styles.idle}>Bağlı öğrenci yok. Davet bağlantısıyla aktive olun.</Text>
      ) : null}
      <Pressable onPress={onOpenProfile} style={styles.logout}>
        <Text style={styles.logoutText}>Bildirimler ve profil</Text>
      </Pressable>
      <Pressable onPress={onLogout} style={styles.logout}>
        <Text style={styles.logoutText}>Çıkış</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.asphalt },
  content: { padding: space.lg, paddingTop: 56 },
  hello: { color: colors.paper, fontSize: 28, fontWeight: '800' },
  lede: { color: colors.muted, marginTop: 6, marginBottom: space.lg },
  error: { color: colors.danger, marginBottom: space.md },
  card: { backgroundColor: colors.steel, borderRadius: 20, padding: space.lg, marginBottom: space.md },
  name: { color: colors.paper, fontSize: 22, fontWeight: '800' },
  meta: { color: colors.muted, marginTop: 4 },
  live: { marginTop: space.md, backgroundColor: '#1A1608', borderRadius: 12, padding: space.md },
  liveEyebrow: { color: colors.headlamp, letterSpacing: 2, fontWeight: '800', fontSize: 11 },
  eta: { color: colors.paper, fontSize: 20, fontWeight: '700', marginTop: 6 },
  stale: { color: colors.headlamp, marginTop: 6 },
  open: { color: colors.headlamp, marginTop: 8, fontWeight: '700' },
  idle: { color: colors.muted, marginTop: space.md },
  logout: { marginTop: space.lg, alignItems: 'center', padding: space.md },
  logoutText: { color: colors.muted, fontWeight: '700' },
});
