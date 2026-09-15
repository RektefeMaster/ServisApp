/**
 * Expo derleme zamanında `process.env.EXPO_PUBLIC_*` değerlerini gömer, ama
 * React Native'de `process.env` tipsizdir (`any`). Tipsiz okuma sessizce
 * `undefined.replace(...)` gibi çalışma zamanı çökmelerine yol açar; bu yüzden
 * ortam değişkeni tek kapıdan ve tip güvenli okunur.
 */
export function envString(key: string): string | undefined {
  const table = process.env as unknown as Record<string, string | undefined>;
  const value = table[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
