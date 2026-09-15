import { View, StyleSheet } from 'react-native';
import { colors, radius, space } from '../theme';
import { AppText } from '../primitives/AppText';
import { StatusIndicator } from '../primitives/StatusIndicator';

type Step = {
  id: string;
  label: string;
  active?: boolean;
  done?: boolean;
};

/** Parent — tam rota değil; yalnız kendi çocuğuyla ilgili ilerleme. */
export function LiveProgress({ steps, caption }: { steps: Step[]; caption?: string }) {
  return (
    <View style={styles.wrap}>
      {caption ? (
        <AppText preset="meta" style={styles.caption}>
          {caption}
        </AppText>
      ) : null}
      {steps.map((step) => (
        <View key={step.id} style={styles.row}>
          <StatusIndicator
            label={step.label}
            tone={step.active ? 'rail' : step.done ? 'ok' : 'neutral'}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.paper,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    gap: space.xs,
    marginTop: space.md,
  },
  caption: {
    marginBottom: space.xxs,
  },
  row: {
    paddingVertical: 10,
  },
});
