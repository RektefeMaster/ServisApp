import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { parseSemver } from '@servisapp/domain';

/**
 * Sunucu `x-app-version` başlığına bakıp 426 Upgrade Required kararı verir
 * (SPEC §12). Sabit '0.0.0' göndermek, minimum sürüm bir gün yükseltildiğinde
 * sahadaki GÜNCEL uygulamaları da kapıda bırakırdı. Bu yüzden sürüm derleme
 * anındaki gerçek uygulama sürümünden okunur.
 */
function fromRuntime(): string | null {
  const native = Application.nativeApplicationVersion;
  if (native && parseSemver(native)) return native;
  const configured = Constants.expoConfig?.version;
  if (configured && parseSemver(configured)) return configured;
  return null;
}

let cached: string | null = null;

export function appVersion(): string {
  cached ??= fromRuntime() ?? '0.0.0';
  return cached;
}

/** Kod imzası: sunucuya gönderilen sürüm okunabildi mi. */
export function appVersionResolved(): boolean {
  return appVersion() !== '0.0.0';
}
