import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../theme';
import { AppText } from './AppText';
import { AppIcon, type IconName } from './AppIcon';

export function FlowHeader({
  title,
  description,
  context,
  icon,
  steps,
  step = 0,
}: {
  title: string;
  description: string;
  context: string;
  icon: IconName;
  steps?: string[];
  step?: number;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.context}>
        <View style={styles.icon}>
          <AppIcon name={icon} color={colors.accent} />
        </View>
        <AppText preset="caption" color={colors.railSoft} style={styles.flex}>
          {context}
        </AppText>
      </View>
      <AppText preset="title" color={colors.paper}>
        {title}
      </AppText>
      <AppText preset="meta" color={colors.railSoft}>
        {description}
      </AppText>
      {steps ? (
        <View style={styles.steps}>
          {steps.map((label, index) => (
            <View key={label} style={styles.flex}>
              <View style={[styles.track, index <= step && styles.trackActive]} />
              <AppText preset="caption" color={index <= step ? colors.paper : '#B8C8C1'}>
                {index + 1}. {label}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ResultCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.result} accessibilityRole="summary" accessibilityLiveRegion="polite">
      <View style={styles.resultIcon}>
        <AppIcon name="check" size={30} />
      </View>
      <AppText preset="title">{title}</AppText>
      <AppText preset="body">{body}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.rail,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 12,
    marginBottom: space.lg,
  },
  context: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#3C514B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  steps: { flexDirection: 'row', gap: 12, marginTop: 8 },
  track: { height: 3, borderRadius: 2, backgroundColor: '#62746C', marginBottom: 8 },
  trackActive: { backgroundColor: colors.accent },
  result: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.md,
    marginVertical: space.lg,
  },
  resultIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.railSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
