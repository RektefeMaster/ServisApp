import { useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, touchTargets } from '../theme';
import { AppText } from './AppText';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'regular' | 'crewPrimary' | 'compact';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  disabled = false,
  loading = false,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const lock = useRef(false);

  function handlePress() {
    if (disabled || loading || lock.current) return;
    lock.current = true;
    try {
      onPress();
    } finally {
      setTimeout(() => {
        lock.current = false;
      }, 400);
    }
  }

  const minHeight =
    size === 'crewPrimary'
      ? touchTargets.crewPrimary
      : size === 'compact'
        ? touchTargets.min
        : touchTargets.parentPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        { minHeight },
        variantStyles[variant],
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading ? styles.pressed : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.paper : colors.rail} />
      ) : (
        <AppText preset="strong" color={labelColor[variant]} style={styles.label}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const labelColor: Record<ButtonVariant, string> = {
  primary: colors.paper,
  secondary: colors.ink,
  danger: colors.danger,
  ghost: colors.rail,
};

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.rail,
  },
  secondary: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  danger: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
});

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  label: {
    textAlign: 'center',
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.45,
  },
});

export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={rowStyles.row}>{children}</View>;
}

const rowStyles = StyleSheet.create({
  row: {
    gap: 8,
  },
});
