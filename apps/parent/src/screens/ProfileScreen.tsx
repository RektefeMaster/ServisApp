import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppText,
  colors,
  Avatar,
  Surface,
  SectionHeading,
  Button,
  IconButton,
  InlineAlert,
  Screen,
  space,
  useHardwareBack,
} from '@servisapp/ui';
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
  useHardwareBack(onBack);

  useEffect(() => {
    void registerParentPush(session).then(setPush);
  }, [session]);

  const pushTitle =
    push?.status === 'registered'
      ? 'Bildirimler açık'
      : (push?.message ?? 'Bildirim kontrol ediliyor…');
  const pushBody =
    push?.status === 'registered'
      ? 'Yaklaşınca ve teslim olaylarında bu cihaza haber gider.'
      : undefined;

  return (
    <Screen scroll>
      <IconButton label="← Ana ekran" onPress={onBack} style={styles.back} />
      <AppText preset="title">Hesabım</AppText>
      <View style={styles.identity}>
        <Avatar name={session.fullName} large />
        <View style={{ flex: 1 }}>
          <AppText preset="section">{session.fullName}</AppText>
          <AppText preset="meta">Veli hesabı</AppText>
        </View>
      </View>
      <SectionHeading title="Tercihler ve gizlilik" />
      <Surface>
        <InlineAlert title={pushTitle} body={pushBody} tone="info" />

        <InlineAlert
          title="Gizlilik"
          body="Canlı haritada yalnız kendi çocuğunun durağı ve aracı görünür. Diğer çocuklar ve tam rota paylaşılmaz."
          tone="info"
        />
      </Surface>
      <Button
        label="Hesaptan çıkış yap"
        variant="secondary"
        onPress={onLogout}
        style={styles.logout}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xl,
    backgroundColor: colors.accentSoft,
    borderRadius: 24,
    padding: 20,
  },
  back: {
    alignSelf: 'flex-start',
    marginBottom: space.xs,
    paddingHorizontal: 0,
  },
  lede: {
    marginTop: space.xxs,
    marginBottom: space.lg,
  },
  logout: {
    marginTop: space.xl,
  },
});
