import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../theme';
import { AppIcon } from './AppIcon';
import { AppText } from './AppText';

export function ActionRow({
  title,
  description,
  index,
  onPress,
}: {
  title: string;
  description: string;
  index: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.icon}>
        <AppIcon name={index === '01' ? 'calendar' : index === '02' ? 'people' : 'pin'} />
      </View>
      <View style={styles.body}>
        <AppText preset="strong">{title}</AppText>
        <AppText preset="meta">{description}</AppText>
      </View>
      <AppIcon name="chevron" size={18} color={colors.mute} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    minHeight: 88,
  },
  icon: {
    width: 44,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 3 },
  pressed: { backgroundColor: colors.railSoft },
});
