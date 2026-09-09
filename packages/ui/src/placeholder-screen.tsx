import { StyleSheet, Text, View } from 'react-native';
import { colors, space } from './theme';

export function PlaceholderScreen({
  title,
  body,
  meta,
}: {
  title: string;
  body: string;
  meta?: string;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: space.sm,
  },
  body: {
    color: colors.muted,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: space.md,
  },
  meta: {
    color: colors.accent,
    fontSize: 13,
  },
});
