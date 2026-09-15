import { Pressable, StyleSheet, View } from 'react-native';
import { colors, elevation, radius, space } from '../theme';
import { AppText } from './AppText';

type ActionToastProps = {
  visible: boolean;
  title: string;
  detail?: string;
  undoLabel?: string;
  onUndo?: () => void;
  /**
   * Bildirimi işlem şeridinin ÜSTÜNE oturtan taban boşluğu.
   *
   * Eskiden sabit 100 puntoydu; şerit içeriğine göre büyüyor (ana işlem 72,
   * ikincil 56, tehlikeli işlem ve araç çubuğu üstüne) ve bildirim şeridin
   * düğmelerinin üstünü kapatıyordu. Şoför "Teslim edilemedi"ye basamıyor,
   * geri alma penceresi boyunca ikincil işlem erişilemez kalıyordu.
   */
  bottomOffset?: number;
};

export function ActionToast({
  visible,
  title,
  detail,
  undoLabel = 'Geri al',
  onUndo,
  bottomOffset,
}: ActionToastProps) {
  if (!visible) return null;

  return (
    <View
      style={[styles.wrap, { bottom: (bottomOffset ?? 88) + space.sm }, elevation.toast]}
      pointerEvents="box-none"
    >
      <View style={styles.card} accessibilityLiveRegion="polite">
        <View style={styles.text}>
          <AppText preset="strong" color={colors.paper}>
            {title}
          </AppText>
          {detail ? (
            <AppText preset="caption" color={colors.line}>
              {detail}
            </AppText>
          ) : null}
        </View>
        {onUndo ? (
          <Pressable onPress={onUndo} hitSlop={8} accessibilityRole="button">
            <AppText preset="strong" color={colors.railSoft}>
              {undoLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    zIndex: 50,
  },
  card: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});
