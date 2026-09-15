import { View, StyleSheet } from 'react-native';
import { colors, space } from '../theme';
import { AppText } from './AppText';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'rail';

const dotColor: Record<Tone, string> = {
  neutral: colors.mute,
  ok: colors.ok,
  warn: colors.warn,
  danger: colors.danger,
  rail: colors.rail,
};

export function StatusIndicator({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: dotColor[tone] }]} />
      <AppText preset="strong" color={colors.ink} style={{ flexShrink: 1 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
