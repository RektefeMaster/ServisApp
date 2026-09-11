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
  await fetch('/api/session/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  wipeLegacyStorage();
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? `İstek başarısız (${response.status})`);
  }
  return body;
}
