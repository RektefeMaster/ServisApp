import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from '../theme';
import { AppText } from './AppText';
import { AppIcon, type IconName } from './AppIcon';

type NavigationItem = {
  label: string;
  icon: IconName;
  /** Sekme seçili mi. `action` öğelerinde anlamsızdır. */
  active?: boolean;
  /** Sekme değil, başka bir ekrana götüren işlem: düğme rolü alır. */
  action?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export function NavigationBar({ items }: { items: NavigationItem[] }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      // Ev göstergesi olan telefonlarda çubuk göstergenin altında kalıyordu:
      // taban dolgusu güvenli alana göre büyür.
      style={[styles.bar, { paddingBottom: styles.bar.paddingBottom + insets.bottom }]}
    >
      {items.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole={item.action ? 'button' : 'tab'}
          accessibilityState={{
            selected: item.action ? undefined : Boolean(item.active),
            disabled: Boolean(item.disabled),
          }}
          disabled={item.disabled}
          onPress={item.onPress}
          style={({ pressed }) => [
            styles.item,
            item.active && styles.active,
            item.disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <AppIcon name={item.icon} color={item.active ? colors.rail : colors.mute} />
          <AppText
            preset="caption"
            color={item.active ? colors.rail : colors.mute}
            numberOfLines={1}
            style={styles.label}
          >
            {item.label}
          </AppText>
          {item.active ? <View style={styles.dot} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: space.sm,
    gap: space.xs,
  },
  item: {
    flex: 1,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 16,
    paddingHorizontal: 4,
  },
  label: { textAlign: 'center' },
  active: { backgroundColor: colors.railSoft },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.rail },
});
