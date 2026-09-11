import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK = 1800;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function setNative(key: string, value: string): Promise<void> {
  if (value.length <= CHUNK) {
    await SecureStore.deleteItemAsync(`${key}.n`, OPTIONS).catch(() => undefined);
    await SecureStore.setItemAsync(key, value, OPTIONS);
    return;
  }
  const parts = Math.ceil(value.length / CHUNK);
  await SecureStore.setItemAsync(key, `__chunks__:${parts}`, OPTIONS);
  for (let i = 0; i < parts; i += 1) {
    await SecureStore.setItemAsync(
      `${key}.${i}`,
      value.slice(i * CHUNK, (i + 1) * CHUNK),
      OPTIONS,
    );
  }
}

async function getNative(key: string): Promise<string | null> {
  const head = await SecureStore.getItemAsync(key, OPTIONS);
  if (!head) return null;
  if (!head.startsWith('__chunks__:')) return head;
  const parts = Number(head.slice('__chunks__:'.length));
  if (!Number.isInteger(parts) || parts < 2) return null;
  const chunks: string[] = [];
  for (let i = 0; i < parts; i += 1) {
    const piece = await SecureStore.getItemAsync(`${key}.${i}`, OPTIONS);
    if (!piece) return null;
    chunks.push(piece);
  }
  return chunks.join('');
}

async function deleteNative(key: string): Promise<void> {
  const head = await SecureStore.getItemAsync(key, OPTIONS);
  if (head?.startsWith('__chunks__:')) {
    const parts = Number(head.slice('__chunks__:'.length));
    if (Number.isInteger(parts) && parts > 0) {
      for (let i = 0; i < parts; i += 1) {
        await SecureStore.deleteItemAsync(`${key}.${i}`, OPTIONS).catch(() => undefined);
      }
    }
  }
  await SecureStore.deleteItemAsync(key, OPTIONS).catch(() => undefined);
  await SecureStore.deleteItemAsync(`${key}.n`, OPTIONS).catch(() => undefined);
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await setNative(key, value);
}

export async function getSecret(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(key);
  }
  const native = await getNative(key);
  if (native) return native;
  const legacy = await AsyncStorage.getItem(key);
  if (!legacy) return null;
  await setNative(key, legacy);
  await AsyncStorage.removeItem(key);
  return legacy;
}

export async function deleteSecret(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  await deleteNative(key);
  await AsyncStorage.removeItem(key);
}
