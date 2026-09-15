import { View, StyleSheet } from 'react-native';
import { colors, radius, space } from '../theme';
import { AppText } from '../primitives/AppText';

export function TripSummary({
  atStopDone,
  atStopTotal,
  onBoard,
  remainingExpected,
}: {
  atStopDone?: number;
  atStopTotal?: number;
  onBoard: number;
  remainingExpected: number;
}) {
  return (
    <View style={styles.row} accessibilityRole="summary">
      {typeof atStopDone === 'number' && typeof atStopTotal === 'number' ? (
        <View style={styles.metric}>
          <AppText preset="monoLarge">
            {atStopDone}/{atStopTotal}
          </AppText>
          <AppText preset="caption">Bu durakta</AppText>
        </View>
      ) : null}
      <View style={styles.metric}>
        <AppText preset="monoLarge">{onBoard}</AppText>
        <AppText preset="caption">Araçta</AppText>
      </View>
      <View style={styles.metric}>
        <AppText preset="monoLarge">{remainingExpected}</AppText>
        <AppText preset="caption">Beklenen</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  metric: {
    flex: 1,
    minWidth: 72,
    gap: 4,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginBottom: space.sm,
  },
});
