import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import { AppText } from './AppText';

type ListRowProps = {
  title: string;
  meta?: string;
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  emphasized?: boolean;
};

export function ListRow({ title, meta, right, onPress, disabled, emphasized }: ListRowProps) {
  const content = (
    <View style={[styles.row, disabled && styles.disabled]}>
      <View style={styles.body}>
        <AppText
          preset={emphasized ? 'strong' : 'body'}
          color={disabled ? colors.mute : colors.ink}
        >
          {title}
        </AppText>
        {meta ? (
          <AppText preset="meta" style={styles.meta}>
            {meta}
          </AppText>
        ) : null}
      </View>
      {right ??
        (onPress ? (
          // Süsleme okunmaz: ekran okuyucu satırın sonunda "›" diyordu.
          <AppText color={colors.mute} accessibilityElementsHidden importantForAccessibility="no">
            ›
          </AppText>
        ) : null)}
    </View>
  );

  if (!onPress || disabled) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: space.sm,
  },
  body: { flex: 1 },
  meta: { marginTop: 2 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
});
