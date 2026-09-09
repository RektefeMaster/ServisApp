import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/** Yalnız Auth / Realtime / Storage. Tablolara doğrudan gidilmez. */
export function createAuthClient(): ReturnType<typeof createClient> {
  const url = process.env['EXPO_PUBLIC_SUPABASE_URL'];
  const publishableKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !publishableKey) {
    throw new Error('Supabase Auth ayarları eksik');
  }
  return createClient(url, publishableKey, {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
