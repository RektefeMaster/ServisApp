/**
 * API kökü derleme zamanında gömülür (`NEXT_PUBLIC_*`), sonradan ayarlanamaz.
 *
 * Eksik değişken sessizce `127.0.0.1:3000`'e düşüyordu: üretimde bu, panelin
 * kendi container'ına istek atması ve operatöre yalnız "bağlanılamadı" demesi
 * demekti. Mobil taraf aynı tuzağa karşı sertleştirilmişti (bkz.
 * `apps/parent/src/api/client.ts`, `docs/store-submission.md`); panel açıkta
 * kalmıştı. Yerel adres artık yalnız geliştirmede kullanılır; eksik
 * yapılandırma ilk istekte açık bir hata verir — derlemeyi kırmaz, çünkü CI
 * yalnız derler ve orada API adresi bilinmez.
 */
function resolveBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  return process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:3000';
}

export const API_BASE_URL = resolveBaseUrl();

export class ApiUnconfiguredError extends Error {
  readonly code = 'api_unconfigured';

  constructor() {
    super('Panel sunucu adresi olmadan derlenmiş (NEXT_PUBLIC_API_URL)');
    this.name = 'ApiUnconfiguredError';
  }
}

export function apiUrl(path: string): string {
  if (!API_BASE_URL) throw new ApiUnconfiguredError();
  return `${API_BASE_URL}${path}`;
}
