import { View, StyleSheet } from 'react-native';
import { space } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <AppText preset="section">{title}</AppText>
      {body ? (
        <AppText preset="meta" style={styles.body}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: space.xl,
    alignItems: 'flex-start',
  },
  body: {
    marginTop: space.xs,
  },
  action: {
    marginTop: space.md,
    alignSelf: 'stretch',
  },
});
