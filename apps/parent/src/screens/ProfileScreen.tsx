import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space } from '@servisapp/ui';
import type { ParentSession } from '../api/client';
import { registerParentPush, type PushRegistration } from '../push';

export function ProfileScreen({
  session,
  onBack,
  onLogout,
}: {
  session: ParentSession;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [push, setPush] = useState<PushRegistration | null>(null);

  useEffect(() => {
    void registerParentPush(session).then(setPush);
  }, [session]);

  const pushText =
    push?.status === 'registered'
      ? 'Bildirimler açık. Yaklaşan servis ve teslim olayları bu cihaza gider.'
      : (push?.message ?? 'Bildirim kaydı kontrol ediliyor…');

  return (
    <View style={styles.screen}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← Ana ekran</Text>
      </Pressable>
      <Text style={styles.title}>Bildirimler ve profil</Text>
      <Text style={styles.lede}>{session.fullName}</Text>
      <View style={styles.card}>
        <Text style={styles.meta}>{pushText}</Text>
      </View>
      <Pressable onPress={onLogout} style={styles.logout}>
        <Text style={styles.logoutText}>Çıkış</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.asphalt, padding: space.lg, paddingTop: 56 },
  back: { color: colors.headlamp, marginBottom: space.md },
  title: { color: colors.paper, fontSize: 28, fontWeight: '800' },
  lede: { color: colors.muted, marginTop: 6, marginBottom: space.lg },
  card: { backgroundColor: colors.steel, borderRadius: 20, padding: space.lg },
  meta: { color: colors.muted },
  logout: { marginTop: space.lg, alignItems: 'center', padding: space.md },
  logoutText: { color: colors.muted, fontWeight: '700' },
});
