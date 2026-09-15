import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import type { ParentHomeChild } from '@servisapp/contracts';
import {
  AppText,
  Avatar,
  AppIcon,
  NavigationBar,
  Brand,
  Button,
  SectionHeading,
  ChildStatusCard,
  EmptyState,
  InlineAlert,
  Screen,
  colors,
  space,
  useHardwareBack,
} from '@servisapp/ui';
import { ApiError, fetchHome, type ParentSession } from '../api/client';
import { deriveChildStatus, sortHomeChildren } from '../status';

export function HomeScreen({
  session,
  onOpenLive,
  onOpenChild,
  onOpenProfile,
  onSessionInvalid,
}: {
  session: ParentSession;
  onOpenLive: (tripId: string, studentId: string, name: string) => void;
  onOpenChild: (studentId: string, name: string) => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  onSessionInvalid: () => void;
}) {
  const [section, setSection] = useState<'today' | 'children'>('today');
  const [children, setChildren] = useState<ParentHomeChild[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Kök ekran: "Bugün"deyken geri tuşu uygulamadan çıkar (null), alt sekmedeyken
  // önce sekmeyi geri alır.
  useHardwareBack(section === 'today' ? null : () => setSection('today'));

  const reload = useCallback(async () => {
    setLoading(true);
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

  const sorted = useMemo(() => sortHomeChildren(children), [children]);

  return (
    <Screen
      nav={
        <NavigationBar
          items={[
            {
              label: 'Bugün',
              icon: 'home',
              active: section === 'today',
              onPress: () => setSection('today'),
            },
            {
              label: 'Çocuklarım',
              icon: 'people',
              active: section === 'children',
              onPress: () => setSection('children'),
            },
            // Sekme değil: ayrı bir ekrana götürür, bu yüzden düğme rolü alır.
            { label: 'Hesabım', icon: 'user', action: true, onPress: onOpenProfile },
          ]}
        />
      }
    >
      <View style={styles.header}>
        <Brand audience="Aile" />
        <Pressable onPress={onOpenProfile} accessibilityRole="button" accessibilityLabel="Hesabım">
          <Avatar name={session.fullName} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.flex}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
      >
        <View style={styles.welcome}>
          <View style={styles.welcomeText}>
            <AppText preset="meta">Merhaba, {session.fullName.trim().split(' ')[0]}</AppText>
            <AppText preset="display">
              {section === 'today' ? 'Bugünün yolculuğu' : 'Çocuklarım'}
            </AppText>
          </View>
        </View>
        <View style={styles.dateLine}>
          <AppIcon name="calendar" size={16} color={colors.mute} />
          <AppText preset="meta">
            {new Intl.DateTimeFormat('tr-TR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'Europe/Istanbul',
            }).format(new Date())}
          </AppText>
        </View>
        <SectionHeading
          title={section === 'today' ? 'Servis durumu' : 'Öğrenci ve servis planı'}
          detail={loading ? undefined : `${children.length} öğrenci`}
        />
        {error ? (
          <>
            <InlineAlert title={error} tone="danger" />
            <Button label="Tekrar dene" variant="secondary" onPress={() => void reload()} />
          </>
        ) : null}

        {loading && children.length === 0 ? (
          <ActivityIndicator color={colors.rail} style={styles.loader} />
        ) : null}

        {sorted.map((child) => {
          const status = deriveChildStatus(child);
          const live = child.live;
          return (
            <ChildStatusCard
              key={child.studentId}
              name={child.fullName}
              schoolName={child.schoolName}
              liveAvailable={Boolean(live?.liveAvailable && !live?.staleMessage)}
              statusLabel={status.statusLabel}
              statusTone={status.statusTone}
              contextLine={status.contextLine}
              warningLine={status.warningLine}
              onPress={() => onOpenChild(child.studentId, child.fullName)}
              onLivePress={
                section === 'today' && status.showLive && live
                  ? () => onOpenLive(live.tripId, child.studentId, child.fullName)
                  : undefined
              }
            />
          );
        })}

        {children.length === 0 && !loading && !error ? (
          <EmptyState
            title="Bağlı öğrenci yok"
            body="Davet bağlantısıyla aktive olduğunda çocukların burada görünür."
          />
        ) : null}

        {section === 'today' && sorted.length > 0 ? (
          <>
            <SectionHeading title="Günlük işlemler" detail="Kolayca yönet" />
            <View style={styles.quickRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Servis planını düzenle"
                onPress={() => {
                  const child = sorted[0];
                  if (child && sorted.length === 1) onOpenChild(child.studentId, child.fullName);
                  else setSection('children');
                }}
                style={styles.quickTile}
              >
                <AppIcon name="calendar" size={26} />
                <AppText preset="strong">Planı düzenle</AppText>
                <AppText preset="caption">Katılım ve teslimat</AppText>
                <View style={styles.quickArrow}>
                  <AppIcon name="arrow" size={16} />
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tüm çocukları görüntüle"
                onPress={() => setSection('children')}
                style={[styles.quickTile, { backgroundColor: colors.railSoft }]}
              >
                <AppIcon name="people" size={26} />
                <AppText preset="strong">Çocuklarım</AppText>
                <AppText preset="caption">Tüm servis planları</AppText>
                <View style={styles.quickArrow}>
                  <AppIcon name="arrow" size={16} />
                </View>
              </Pressable>
            </View>
          </>
        ) : null}
        <AppText preset="caption" style={styles.footer}>
          Güncel bilgi için ekranı aşağı çekebilirsin.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dateLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quickRow: { flexDirection: 'row', gap: 12 },
  quickTile: {
    flex: 1,
    backgroundColor: colors.accentSoft,
    borderRadius: 20,
    padding: 16,
    gap: 8,
    minHeight: 164,
  },
  quickArrow: { alignSelf: 'flex-end' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  content: {
    paddingBottom: space.xxl,
    flexGrow: 1,
  },
  loader: { marginVertical: space.lg },
  welcome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  welcomeText: { flex: 1, gap: space.xs },
  footer: {
    textAlign: 'center',
    alignSelf: 'center',
    marginTop: space.lg,
  },
});
