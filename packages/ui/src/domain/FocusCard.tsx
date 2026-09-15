import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { colors, elevation, radius, space } from '../theme';
import { AppIcon } from '../primitives/AppIcon';
import { Avatar } from '../primitives/Identity';
import { AppText } from '../primitives/AppText';
import { StatusIndicator } from '../primitives/StatusIndicator';
import { SyncBadge, type SyncState } from './SyncBadge';

type FocusCardProps = {
  name: string;
  stateLabel: string;
  stateTone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'rail';
  stopLabel?: string | null;
  phone?: string | null;
  tempDelivery?: boolean;
  tempReceiverName?: string | null;
  /** GUARDIAN_REQUIRED eve teslimde çocuğu alabilecek kişi(ler). */
  handoverTo?: string | null;
  manualOverride?: boolean;
  onReturnToSequence?: () => void;
  syncState?: SyncState;
  needsReview?: boolean;
};

export function FocusCard({
  name,
  stateLabel,
  stateTone = 'rail',
  stopLabel,
  phone,
  tempDelivery,
  tempReceiverName,
  handoverTo,
  manualOverride,
  onReturnToSequence,
  syncState,
  needsReview,
}: FocusCardProps) {
  return (
    <View style={styles.card} accessibilityLabel={`${name}, ${stateLabel}`}>
      <View style={styles.cardHeader}>
        <AppText preset="caption">{manualOverride ? 'SEÇİLEN ÖĞRENCİ' : 'SIRADAKİ İŞLEM'}</AppText>
        <Avatar name={name} large />
      </View>
      <AppText preset="focus" style={styles.name}>
        {name}
      </AppText>
      <StatusIndicator label={stateLabel} tone={stateTone} />
      {syncState ? <SyncBadge state={syncState} /> : null}
      {stopLabel ? (
        <AppText preset="meta" style={styles.stop}>
          {stopLabel}
        </AppText>
      ) : null}
      {tempDelivery ? (
        <View style={styles.temp}>
          <AppText preset="strong" color={colors.warn}>
            Farklı adrese teslim
          </AppText>
          {tempReceiverName ? (
            <AppText preset="meta">Teslim alan: {tempReceiverName}</AppText>
          ) : null}
        </View>
      ) : null}
      {handoverTo ? (
        <View style={styles.temp}>
          <AppText preset="strong">Yalnız yetkiliye teslim</AppText>
          <AppText preset="meta">{handoverTo}</AppText>
        </View>
      ) : null}
      {needsReview ? (
        <AppText preset="meta" color={colors.danger} style={styles.review}>
          Çakışma: insan onayı gerekli
        </AppText>
      ) : null}
      {phone ? (
        <Pressable
          onPress={() => void Linking.openURL(`tel:${phone}`)}
          accessibilityRole="button"
          accessibilityLabel={`Ara ${phone}`}
          style={styles.phone}
        >
          <AppIcon name="phone" color={colors.rail} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText preset="strong">Veliyi ara</AppText>
            <AppText preset="meta">{phone}</AppText>
          </View>
          <AppIcon name="arrow" size={18} />
        </Pressable>
      ) : (
        <AppText preset="meta" style={styles.phone}>
          Veli telefonu yok
        </AppText>
      )}
      {manualOverride ? (
        <Pressable onPress={onReturnToSequence} style={styles.override}>
          <AppText preset="meta" color={colors.rail}>
            Manuel seçim · Sıradakine dön
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...elevation.card,
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    alignItems: 'flex-start',
    gap: space.xs,
    flexGrow: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
    backgroundColor: colors.railSoft,
    padding: space.md,
    borderRadius: radius.md,
    gap: 12,
  },
  name: {
    marginBottom: space.xxs,
  },
  stop: {
    marginTop: space.xxs,
  },
  temp: {
    marginTop: space.xs,
    gap: 2,
  },
  review: {
    marginTop: space.xxs,
  },
  phone: {
    marginTop: space.sm,
    minHeight: 48,
    backgroundColor: colors.railSoft,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 12,
  },
  override: {
    marginTop: space.sm,
    minHeight: 40,
    justifyContent: 'center',
  },
});
