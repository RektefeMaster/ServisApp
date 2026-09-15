import { View, StyleSheet } from 'react-native';
import { colors, radius, space } from '../theme';
import { AppText } from './AppText';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'rail';

const toneStyle: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.mist, fg: colors.ink },
  ok: { bg: colors.okSoft, fg: colors.ok },
  warn: { bg: colors.warnSoft, fg: colors.warn },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  rail: { bg: colors.railSoft, fg: colors.rail },
};

/** Yalnız compact categorical state gerektiğinde. Her status otomatik chip olmaz. */
export function StatusChip({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = toneStyle[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <AppText preset="caption" color={t.fg}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.xs,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
});
