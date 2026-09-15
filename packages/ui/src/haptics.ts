import * as Haptics from 'expo-haptics';

export type HapticKind = 'success' | 'risk' | 'error';

export async function triggerHaptic(kind: HapticKind): Promise<void> {
  try {
    switch (kind) {
      case 'success':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case 'risk':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      default: {
        const unexpected: never = kind;
        void unexpected;
      }
    }
  } catch {
    // Haptic yoksa (simulator / izin) sessizce geç.
  }
}
