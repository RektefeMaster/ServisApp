import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerPushToken } from './api/client';
import type { ParentSession } from './api/client';
import { loadDeviceId } from './auth';

export type PushRegistration =
  | { status: 'registered' }
  | { status: 'denied'; message: string }
  | { status: 'unavailable'; message: string };

export async function registerParentPush(session: ParentSession): Promise<PushRegistration> {
  if (Platform.OS === 'web') {
    return {
      status: 'unavailable',
      message: 'Push webde yok. iOS veya Android uygulama gerekir.',
    };
  }
  if (!Device.isDevice) {
    return {
      status: 'unavailable',
      message: 'Push yalnız fiziksel cihazda kayıtlanır.',
    };
  }
  try {
    const current = await Notifications.getPermissionsAsync();
    const asked = current.granted
      ? current
      : await Notifications.requestPermissionsAsync();
    if (!asked.granted) {
      return {
        status: 'denied',
        message: 'Bildirim izni kapalı. Ayarlardan açınca servis yaklaşınca haber gider.',
      };
    }
    const projectId = process.env['EXPO_PUBLIC_EAS_PROJECT_ID']?.trim();
    const token = (
      await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {})
    ).data;
    await registerPushToken(session, {
      deviceId: await loadDeviceId(),
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      pushToken: token,
    });
    return { status: 'registered' };
  } catch {
    return {
      status: 'unavailable',
      message: 'Push kaydı bu kurulumda tamamlanamadı. Olaylar kuyruğa yazılır; sahte liste yok.',
    };
  }
}
