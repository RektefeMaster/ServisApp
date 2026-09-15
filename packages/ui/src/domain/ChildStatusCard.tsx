import { Pressable, StyleSheet, View } from 'react-native';
import { colors, elevation, radius, space } from '../theme';
import { Avatar } from '../primitives/Identity';
import { AppIcon } from '../primitives/AppIcon';
import { JourneyArt } from '../primitives/JourneyArt';
import { AppText } from '../primitives/AppText';
import { StatusIndicator } from '../primitives/StatusIndicator';
type ChildStatusCardProps = {
  name: string;
  schoolName?: string;
  statusLabel: string;
  statusTone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'rail';
  contextLine?: string | null;
  warningLine?: string | null;
  onPress?: () => void;
  onLivePress?: () => void;
  liveLabel?: string;
  liveAvailable?: boolean;
};
export function ChildStatusCard({
  name,
  schoolName,
  statusLabel,
  statusTone = 'neutral',
  contextLine,
  warningLine,
  onPress,
  onLivePress,
  liveLabel = 'Yolculuğu görüntüle',
  liveAvailable = false,
}: ChildStatusCardProps) {
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${statusLabel}`}
        style={({ pressed }) => [styles.identity, pressed && { opacity: 0.7 }]}
      >
        <Avatar name={name} />
        <View style={styles.identityText}>
          <AppText preset="section">{name}</AppText>
          <AppText preset="caption">{schoolName ?? 'Servis planı'}</AppText>
        </View>
        <AppIcon name="chevron" size={18} color={colors.mute} />
      </Pressable>
      {onLivePress ? (
        <View style={styles.journey}>
          <View style={styles.liveHeading}>
            <View style={styles.liveBadge}>
              <View
                style={[styles.dot, { backgroundColor: liveAvailable ? colors.accent : '#D1DDD6' }]}
              />
              <AppText preset="caption" color={colors.paper}>
                {liveAvailable ? 'CANLI YOLCULUK' : 'YOLCULUK DURUMU'}
              </AppText>
            </View>
            <AppIcon name="shield" size={18} color={colors.accent} />
          </View>
          <AppText preset="focus" color={statusTone === 'danger' ? '#FFC1B8' : colors.paper}>
            {statusLabel}
          </AppText>
          {contextLine ? (
            <AppText preset="section" color={colors.accent}>
              {contextLine}
            </AppText>
          ) : null}
          <View style={styles.art}>
            <JourneyArt compact />
          </View>
          <Pressable
            onPress={onLivePress}
            accessibilityRole="button"
            accessibilityLabel={liveLabel}
            style={({ pressed }) => [styles.live, pressed && { opacity: 0.75 }]}
          >
            <AppText preset="strong" color={colors.rail} style={{ flex: 1 }}>
              {liveLabel}
            </AppText>
            <AppIcon name="arrow" color={colors.rail} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.idle}>
          <View style={styles.idleIcon}>
            <AppIcon name="calendar" color={colors.rail} />
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <StatusIndicator label={statusLabel} tone={statusTone} />
            {contextLine ? <AppText preset="meta">{contextLine}</AppText> : null}
          </View>
        </View>
      )}
      {warningLine ? (
        <View style={styles.warning}>
          <AppText preset="meta" color={colors.warn}>
            {warningLine}
          </AppText>
        </View>
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
    marginBottom: space.md,
    overflow: 'hidden',
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.md,
    gap: space.sm,
    minHeight: 86,
  },
  identityText: { flex: 1, gap: 4 },
  journey: {
    backgroundColor: colors.rail,
    margin: 6,
    marginTop: 0,
    padding: space.lg,
    borderRadius: 20,
    gap: 8,
    overflow: 'hidden',
  },
  liveHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  liveBadge: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  art: { marginVertical: -8, opacity: 0.85 },
  live: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.accent,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  idle: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginHorizontal: space.md,
    paddingVertical: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  idleIcon: {
    width: 40,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.railSoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  warning: { padding: space.md, backgroundColor: colors.warnSoft },
});
