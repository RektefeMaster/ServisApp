/**
 * Davet jetonunu bir bağlantıdan ya da elle yapıştırılan metinden çıkarır.
 *
 * Veli SMS'te `https://panel.example/i/<token>` alır; uygulama derin bağlantıyla
 * (`servisapp-parent://i/<token>`) açılabilir, ama telefon linki tarayıcıda
 * açtıysa veli linki kopyalayıp yapıştırır. Üç girişi de aynı yer çözer.
 *
 * Bağlantı YETKİ DEĞİLDİR: jeton yalnız hangi daveti aktive etmek istediğimizi
 * söyler; kimliği telefon doğrulaması kanıtlar (SPEC onboarding).
 */
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{16,200}$/;

export function parseInviteToken(input: string): string | null {
  const raw = input.trim();
  if (raw.length === 0) return null;
  const candidate = tokenFromUrl(raw) ?? raw;
  return TOKEN_PATTERN.test(candidate) ? candidate : null;
}

function tokenFromUrl(raw: string): string | null {
  if (!raw.includes('/') && !raw.includes(':')) return null;
  const withoutQuery = raw.split(/[?#]/)[0] ?? raw;
  const segments = withoutQuery.split('/').filter((part) => part.length > 0);
  const marker = segments.lastIndexOf('i');
  if (marker >= 0 && marker + 1 < segments.length) return segments[marker + 1] ?? null;
  const last = segments[segments.length - 1];
  return last ?? null;
}
