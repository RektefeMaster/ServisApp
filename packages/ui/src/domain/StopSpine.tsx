import { View, StyleSheet } from 'react-native';
import { colors, space } from '../theme';
import { AppText } from '../primitives/AppText';

export type SpineStop = {
  id: string;
  label: string;
  status: 'past' | 'active' | 'future';
};

/** Crew rota context — kompakt, tüm rotayı dikey mezarlığa çevirmez. */
export function StopSpine({
  stops,
  progressLabel,
}: {
  stops: SpineStop[];
  progressLabel?: string;
}) {
  const visible = stops.slice(0, 5);

  return (
    <View style={styles.wrap} accessibilityLabel={progressLabel ?? 'Rota ilerlemesi'}>
      <View style={styles.rail}>
        {visible.map((stop, index) => (
          <View key={stop.id} style={styles.nodeRow}>
            <View
              style={[
                styles.node,
                stop.status === 'past' && styles.past,
                stop.status === 'active' && styles.active,
                stop.status === 'future' && styles.future,
              ]}
            />
            {index < visible.length - 1 ? <View style={styles.segment} /> : null}
          </View>
        ))}
      </View>
      <View style={styles.labels}>
        {visible.map((stop) => (
          <AppText
            key={stop.id}
            preset={stop.status === 'active' ? 'strong' : 'meta'}
            color={stop.status === 'future' ? colors.mute : colors.ink}
            numberOfLines={2}
            style={{ flex: 1 }}
          >
            {stop.label}
          </AppText>
        ))}
      </View>
      {progressLabel ? (
        <AppText preset="meta" style={styles.progress}>
          {progressLabel}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: space.md,
  },
  rail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  nodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  node: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  past: { backgroundColor: colors.rail },
  active: { backgroundColor: colors.rail, width: 12, height: 12, borderRadius: 6 },
  future: {
    backgroundColor: colors.paper,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  segment: {
    flex: 1,
    height: 2,
    backgroundColor: colors.line,
    marginHorizontal: 4,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  progress: {
    marginTop: space.xs,
  },
});
