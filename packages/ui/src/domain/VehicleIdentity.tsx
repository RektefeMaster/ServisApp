import { View, StyleSheet } from 'react-native';
import { colors, space } from '../theme';
import { AppText } from '../primitives/AppText';

export function VehicleIdentity({
  plate,
  meta,
  compact,
}: {
  plate: string;
  meta?: string;
  compact?: boolean;
}) {
  return (
    <View style={styles.wrap} accessibilityLabel={`Plaka ${plate}`}>
      <AppText preset={compact ? 'monoSmall' : 'mono'} color={colors.ink}>
        {plate}
      </AppText>
      {meta ? (
        <AppText preset="caption" style={styles.meta}>
          {meta}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 2,
  },
  meta: {
    marginTop: space.xxs,
  },
});
