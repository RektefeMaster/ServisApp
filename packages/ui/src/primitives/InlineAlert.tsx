import { View, StyleSheet } from 'react-native';
import { colors, radius, space } from '../theme';
import { AppText } from './AppText';

type Tone = 'info' | 'warn' | 'danger' | 'ok';

const toneBg: Record<Tone, string> = {
  info: colors.railSoft,
  warn: colors.warnSoft,
  danger: colors.dangerSoft,
  ok: colors.okSoft,
};

const toneFg: Record<Tone, string> = {
  info: colors.rail,
  warn: colors.warn,
  danger: colors.danger,
  ok: colors.ok,
};

export function InlineAlert({
  title,
  body,
  tone = 'info',
}: {
  title: string;
  body?: string;
  tone?: Tone;
}) {
  return (
    <View
      style={[styles.wrap, { backgroundColor: toneBg[tone] }]}
      accessibilityRole="alert"
      accessibilityLabel={`${title}${body ? `. ${body}` : ''}`}
    >
      <AppText preset="strong" color={toneFg[tone]}>
        {title}
      </AppText>
      {body ? (
        <AppText preset="meta" color={colors.ink} style={styles.body}>
          {body}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  body: {
    marginTop: space.xxs,
  },
});
