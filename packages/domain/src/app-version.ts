/**
 * Mobil istemci sürümü. 426 kararı sunucuda bu karşılaştırmayla verilir
 * (SPEC §12). Biçimsiz sürüm desteklenmiyor sayılır — eski APK sessizce
 * içeri alınmaz.
 */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

export function parseSemver(version: string): [number, number, number] | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    const diff = left[i]! - right[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isAppVersionSupported(current: string, minimum: string): boolean {
  const cmp = compareSemver(current, minimum);
  return cmp !== null && cmp >= 0;
}
