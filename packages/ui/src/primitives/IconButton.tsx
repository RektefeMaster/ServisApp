import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, touchTargets } from '../theme';
import { AppText } from './AppText';

type IconButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Quiet supporting action with a full accessible touch target. */
export function IconButton({ label, onPress, disabled, style }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        disabled && styles.disabled,
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
      <AppText preset="meta" color={colors.rail} style={{ textAlign: 'center' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTargets.min,
    minWidth: touchTargets.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
