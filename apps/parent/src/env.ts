/** Expo yalnız nokta notasyonuyla yazılmış sabit anahtarları pakete gömer. */
const publicEnv = {
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL as unknown,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL as unknown,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as unknown,
  EXPO_PUBLIC_DEV_LOGIN: process.env.EXPO_PUBLIC_DEV_LOGIN as unknown,
  EXPO_PUBLIC_EAS_PROJECT_ID: process.env.EXPO_PUBLIC_EAS_PROJECT_ID as unknown,
} as const;

export function envString(key: keyof typeof publicEnv): string | undefined {
  const value: unknown = publicEnv[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
