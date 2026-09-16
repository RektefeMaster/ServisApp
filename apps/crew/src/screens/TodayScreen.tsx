import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { resumeOpenTrip, ymdInTimeZone } from '@servisapp/domain';
import type { TripSummary } from '@servisapp/contracts';
import {
  AppText,
  Brand,
  AppIcon,
  Avatar,
  JourneyArt,
  NavigationBar,
  BottomSheet,
  SectionHeading,
  StatusChip,
  Button,
  EmptyState,
  InlineAlert,
  Screen,
  VehicleIdentity,
  colors,
  radius,
  space,
  useHardwareBack,
} from '@servisapp/ui';
import { ApiError, listTrips, type CrewSession } from '../api/client';
import { loadLastTripId } from '../auth';
import { formatClock, segmentLabel, tripStateLabel } from '../format';
import { listOutbox } from '../outbox';

function formatDayTitle(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return ymd;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Istanbul',
  }).format(date);
}

export function TodayScreen({
  session,
  autoOpenActiveTrip = true,
  onOpenTrip,
  onLogout,
  onSessionInvalid,
}: {
  session: CrewSession;
  autoOpenActiveTrip?: boolean;
  onOpenTrip: (tripId: string) => void;
  onLogout: () => void;
  onSessionInvalid: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [segment, setSegment] = useState<'ALL' | 'MORNING' | 'AFTERNOON'>('ALL');
  const [items, setItems] = useState<TripSummary[]>([]);
  const [resume, setResume] = useState<{ id: string; reason: 'ACTIVE' | 'LAST_OPEN' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const refreshLock = useRef(false);
  const [queueTick, setQueueTick] = useState(0);
  const date = ymdInTimeZone(new Date(), 'Europe/Istanbul');

  // Kök ekran. Hesap paneli açıkken geri tuşu önce paneli kapatır; kapalıyken
  // uygulamadan çıkmak doğrudur (null).
  useHardwareBack(accountOpen ? () => setAccountOpen(false) : null);

  const reload = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    setLoading(true);
    setError(null);
    try {
      const trips = await listTrips(session, date);
      setItems(trips);
      setUpdatedAt(
        new Intl.DateTimeFormat('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Istanbul',
        }).format(new Date()),
      );
      const last = await loadLastTripId();
      setResume(
        resumeOpenTrip(
          trips.map((trip) => ({ id: trip.id, state: trip.state })),
          last,
        ),
      );
      setQueueTick((value) => value + 1);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionInvalid();
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Seferler alınamadı');
    } finally {
      refreshLock.current = false;
      setLoading(false);
    }
  }, [date, onSessionInvalid, session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!autoOpenActiveTrip || !resume || resume.reason !== 'ACTIVE') return;
    onOpenTrip(resume.id);
  }, [autoOpenActiveTrip, resume, onOpenTrip]);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (left, right) =>
          new Date(left.plannedDepartureAt).getTime() -
          new Date(right.plannedDepartureAt).getTime(),
      ),
    [items],
  );

  const pendingQueue =
    queueTick >= 0
      ? listOutbox().filter((item) => item.status === 'PENDING' || item.status === 'IN_FLIGHT')
          .length
      : 0;

  const resumeTrip =
    (resume ? items.find((trip) => trip.id === resume.id) : null) ??
    sorted.find(
      (trip) => trip.state === 'PLANNED' || trip.state === 'READY' || trip.state === 'ACTIVE',
    );

  return (
    <Screen
      nav={
        <NavigationBar
          items={[
            {
              label: 'Seferler',
              icon: 'route',
              active: !accountOpen,
              onPress: () => setAccountOpen(false),
            },
            {
              label: 'Yenile',
              icon: 'refresh',
              action: true,
              disabled: loading,
              onPress: () => {
                if (!loading) void reload();
              },
            },
            {
              label: 'Hesabım',
              icon: 'user',
              active: accountOpen,
              onPress: () => setAccountOpen(true),
            },
          ]}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Brand audience="Ekip" />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hesabım"
          onPress={() => setAccountOpen(true)}
        >
          <Avatar name={session.fullName} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.flex}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading && items.length > 0}
            onRefresh={() => void reload()}
            tintColor={colors.rail}
          />
        }
      >
        <View style={styles.updateStatus}>
          <View style={[styles.updateDot, error && { backgroundColor: colors.warn }]} />
          <AppText preset="caption">
            {loading
              ? 'Seferler güncelleniyor…'
              : error
                ? 'Güncelleme bekleniyor'
                : updatedAt
                  ? `Son güncelleme ${updatedAt}`
                  : 'Sefer bilgileri'}
          </AppText>
        </View>
        <View style={styles.welcome}>
          <AppText preset="meta">Merhaba, {session.fullName.trim().split(' ')[0]}</AppText>
          <AppText preset="display">Sefer merkezi</AppText>
          <AppText preset="meta">{formatDayTitle(date)}</AppText>
        </View>

        <View style={styles.stats}>
          {[
            { value: items.length, label: 'Sefer', icon: 'route' as const },
            {
              value: items.filter((t) => t.state === 'ACTIVE').length,
              label: 'Aktif',
              icon: 'bus' as const,
            },
            {
              value: items.filter((t) => t.state === 'COMPLETED').length,
              label: 'Tamamlanan',
              icon: 'check' as const,
            },
          ].map((metric) => (
            <View key={metric.label} style={styles.stat}>
              <AppIcon name={metric.icon} size={18} color={colors.mute} />
              <AppText preset="title">{updatedAt ? metric.value : '—'}</AppText>
              <AppText preset="caption">{metric.label}</AppText>
            </View>
          ))}
        </View>
        {pendingQueue > 0 ? (
          <InlineAlert
            tone="warn"
            title={`${pendingQueue} işlem henüz gönderilmedi`}
            body="Sefer içinde işaretlerin kuyrukta olabilir."
          />
        ) : null}

        {resumeTrip ? (
          <Pressable
            onPress={() => onOpenTrip(resumeTrip.id)}
            style={({ pressed }) => [
              styles.resume,
              styles.resumeActive,
              pressed && { opacity: 0.88 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${resumeTrip.schoolName}, seferi aç`}
          >
            <View style={styles.featureTop}>
              <AppText preset="caption" color={colors.railSoft}>
                {resumeTrip.state === 'ACTIVE'
                  ? 'DEVAM EDEN SEFER'
                  : resume
                    ? 'SON AÇILAN SEFER'
                    : 'SIRADAKİ SEFER'}
              </AppText>
              <AppIcon name="arrow" color={colors.accent} />
            </View>
            <View style={styles.ticketTime}>
              <AppText preset="display" color={colors.paper}>
                {formatClock(resumeTrip.plannedDepartureAt)}
              </AppText>
              <View style={styles.plate}>
                <AppIcon name="bus" size={18} color={colors.accent} />
                <AppText preset="monoSmall" color={colors.paper}>
                  {resumeTrip.plate}
                </AppText>
              </View>
            </View>
            <AppText preset="section" color={colors.paper}>
              {resumeTrip.schoolName}
            </AppText>
            <AppText preset="meta" color={colors.railSoft}>
              {segmentLabel(resumeTrip.segment)} · {tripStateLabel(resumeTrip.state)}
            </AppText>
            <View style={styles.featureBottom}>
              <AppText preset="strong" color={colors.rail}>
                {resumeTrip.state === 'ACTIVE' ? 'Sefere devam et' : 'Seferi incele'}
              </AppText>
              <AppIcon name="arrow" color={colors.rail} />
            </View>
            <JourneyArt compact />
          </Pressable>
        ) : null}

        {error ? (
          <View>
            <InlineAlert
              tone="danger"
              title={error}
              body={
                updatedAt
                  ? 'Son alınan seferleri görüyorsun. Güncellemek için yeniden dene.'
                  : 'Bağlantını kontrol edip yeniden dene.'
              }
            />
            <Button
              label="Yeniden dene"
              variant="secondary"
              loading={loading}
              onPress={() => void reload()}
            />
          </View>
        ) : null}
        {loading && items.length === 0 ? <ActivityIndicator color={colors.rail} /> : null}

        <SectionHeading
          title="Günün akışı"
          detail={loading ? undefined : `${items.length} sefer`}
        />

        <View style={styles.filters}>
          {(
            [
              { key: 'ALL', label: 'Tümü' },
              { key: 'MORNING', label: 'Sabah' },
              { key: 'AFTERNOON', label: 'Akşam' },
            ] as const
          ).map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === item.key }}
              onPress={() => setSegment(item.key)}
              style={[styles.filter, segment === item.key && styles.filterActive]}
            >
              <AppText preset="caption" color={segment === item.key ? colors.paper : colors.mute}>
                {item.label}
              </AppText>
            </Pressable>
          ))}
        </View>
        {sorted
          .filter((trip) => segment === 'ALL' || trip.segment === segment)
          .map((trip) => {
            const active = trip.state === 'ACTIVE';
            const done =
              trip.state === 'COMPLETED' ||
              trip.state === 'CANCELLED' ||
              trip.state === 'ABORTED' ||
              trip.state === 'AUTO_CLOSED';
            return (
              <Pressable
                key={trip.id}
                onPress={() => onOpenTrip(trip.id)}
                style={({ pressed }) => [
                  styles.row,
                  done && styles.rowDone,
                  pressed && { backgroundColor: colors.railSoft },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${formatClock(trip.plannedDepartureAt)} ${segmentLabel(trip.segment)} ${trip.schoolName}`}
              >
                <View style={styles.timeBlock}>
                  <AppText preset="mono" color={active ? colors.rail : colors.ink}>
                    {formatClock(trip.plannedDepartureAt)}
                  </AppText>
                  <AppText preset="caption">{segmentLabel(trip.segment)}</AppText>
                </View>
                <View style={styles.rowBody}>
                  <AppText preset="strong" color={done ? colors.mute : colors.ink}>
                    {trip.schoolName}
                  </AppText>
                  <VehicleIdentity plate={trip.plate} compact />
                  <StatusChip label={tripStateLabel(trip.state)} tone={active ? 'ok' : 'neutral'} />
                </View>
                {!done ? (
                  <AppText preset="strong" color={colors.rail}>
                    ›
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}

        {!loading &&
        sorted.filter((trip) => segment === 'ALL' || trip.segment === segment).length === 0 &&
        !error ? (
          <EmptyState
            title={segment === 'ALL' ? 'Bugün atanmış sefer yok' : 'Bu zaman diliminde sefer yok'}
            body="Yeni sefer atanınca burada görünür."
          />
        ) : null}

        <Button
          label="Seferleri yenile"
          onPress={() => void reload()}
          variant="secondary"
          loading={loading}
          style={styles.logout}
        />
      </ScrollView>
      <BottomSheet visible={accountOpen} title="Ekip hesabım" onClose={() => setAccountOpen(false)}>
        <View style={styles.account}>
          <Avatar name={session.fullName} large />
          <AppText preset="title">{session.fullName}</AppText>
          <AppText preset="meta">
            {session.roles.includes('DRIVER') ? 'Şoför' : 'Servis personeli'}
          </AppText>
          <AppText preset="meta">
            {loading
              ? 'Sefer bilgileri yükleniyor…'
              : error
                ? 'Son yenileme başarısız'
                : updatedAt
                  ? `Son güncelleme ${updatedAt}`
                  : 'Henüz güncellenmedi'}
          </AppText>
        </View>
        <Button label="Hesaptan çıkış yap" variant="secondary" onPress={onLogout} />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  updateStatus: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  updateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ok },
  stats: {
    flexDirection: 'row',
    backgroundColor: colors.accentSoft,
    borderRadius: 20,
    marginBottom: 20,
    paddingVertical: 14,
  },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  ticketTime: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  plate: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#566B66',
    padding: 9,
    borderRadius: 10,
  },
  filters: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    backgroundColor: colors.paper,
    padding: 5,
    borderRadius: 16,
  },
  filter: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  filterActive: { backgroundColor: colors.rail },
  account: { alignItems: 'center', gap: 12, paddingBottom: 24 },
  welcome: { gap: space.xs, marginTop: space.sm, marginBottom: space.xl },
  featureTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  featureBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: 0,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.accent,
  },
  timeBlock: {
    gap: 6,
    minWidth: 66,
    borderRightWidth: 1,
    borderRightColor: colors.line,
    paddingRight: 12,
  },
  content: {
    paddingBottom: space.xxxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: space.lg,
  },
  headerText: { gap: 4, flex: 1 },
  section: { marginBottom: space.sm, marginTop: space.sm },
  resume: {
    borderRadius: radius.lg,
    padding: space.xl,
    marginBottom: space.md,
    gap: space.xs,
  },
  resumeActive: { backgroundColor: colors.rail },
  resumeLast: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  resumeCta: { marginTop: space.xxs },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.md,
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: space.sm,
  },
  rowDone: { backgroundColor: colors.mist },
  rowBody: { flex: 1, gap: 8 },
  logout: { marginTop: space.xl },
  refresh: { alignItems: 'center', padding: space.md },
});
