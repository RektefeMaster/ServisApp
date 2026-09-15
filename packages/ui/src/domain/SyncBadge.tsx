import { View, StyleSheet } from 'react-native';
import { colors, space } from '../theme';
import { AppText } from '../primitives/AppText';

export type SyncState = 'queued' | 'sending' | 'failed' | null;

export function SyncBadge({ state }: { state: SyncState }) {
  if (!state) return null;

  const label =
    state === 'queued' ? 'Bekliyor' : state === 'sending' ? 'Gönderiliyor' : 'Gönderilemedi';
  const color =
    state === 'failed' ? colors.danger : state === 'sending' ? colors.rail : colors.warn;

  return (
    <View style={styles.row} accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText preset="caption" color={color}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    marginTop: space.xxs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
