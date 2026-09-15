'use client';

const LEGACY_TOKEN_KEY = 'servisapp.admin.token';
const LEGACY_TENANT_KEY = 'servisapp.admin.tenant';

export interface SessionMembership {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  status: string;
  roles: string[];
}

export interface SessionBody {
  identityId: string;
  fullName: string;
  memberships: SessionMembership[];
  membership: SessionMembership | null;
}

function wipeLegacyStorage(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_TENANT_KEY);
}

export { wipeLegacyStorage as discardLegacyBrowserToken };

export async function setTenant(tenantId: string): Promise<void> {
  wipeLegacyStorage();
  const response = await fetch('/api/session/tenant', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ tenantId }),
  });
  if (!response.ok) {
    throw new Error('Şirket seçilemedi');
  }
}

export async function clearSession(): Promise<void> {
  wipeLegacyStorage();
  const { signOutAuth } = await import('./supabase');
  await signOutAuth();
  await fetch('/api/session/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
}

/** HTTP durumunu taşır: çağıranlar 401 ile 500'ü ayırt edebilsin. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Tarayıcıdaki Supabase oturumu canlıyken çerezdeki jeton eskiyebilir. 401
 * alındığında güncel jetonla çerez sessizce yenilenir; aksi hâlde operatör
 * akşam sevkiyatının ortasında oturumdan düşüyordu.
 */
async function renewSession(): Promise<boolean> {
  const { currentAccessToken } = await import('./supabase');
  const accessToken = await currentAccessToken();
  if (!accessToken) return false;
  const response = await fetch('/api/session/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  return response.ok;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  wipeLegacyStorage();
  // Gövde yoksa content-type da gönderilmez: "application/json" + boş gövde,
  // sunucu tarafında geçersiz istektir.
  const hasBody = init?.body !== undefined && init.body !== null;
  const send = (): Promise<Response> =>
    fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });

  let response = await send();
  if (response.status === 401 && (await renewSession())) {
    response = await send();
  }
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error ?? 'http_error',
      body.message ?? body.error ?? `İstek başarısız (${String(response.status)})`,
    );
  }
  return body;
}
