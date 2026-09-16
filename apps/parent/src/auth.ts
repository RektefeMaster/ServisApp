import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import { toPhoneE164 } from '@servisapp/domain';
import {
  ApiError,
  setAccessTokenProvider,
  activateInvite,
  devParentLogin,
  fetchSession,
  type ParentSession,
} from './api/client';
import { envString } from './env';
import { deleteSecret, getSecret, setSecret } from './secure-storage';

const SESSION_KEY = 'parent.session';
const DEVICE_KEY = 'parent.deviceId';

let authClient: ReturnType<typeof createClient> | null = null;

/**
 * Tek örnek. Her çağrıda yeni istemci kurmak, her birinin kendi yenileme
 * zamanlayıcısını çalıştırması ve hiçbirinin uygulamanın kullandığı jetonla
 * ilişkilenmemesi demekti.
 */
function createAuthClient(): ReturnType<typeof createClient> | null {
  if (authClient) return authClient;
  const url = envString('EXPO_PUBLIC_SUPABASE_URL');
  const publishableKey = envString('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !publishableKey) return null;
  authClient = createClient(url, publishableKey, {
    auth: {
      storage: {
        getItem: (key) => getSecret(key),
        setItem: (key, value) => setSecret(key, value),
        removeItem: (key) => deleteSecret(key),
      },
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return authClient;
}

setAccessTokenProvider(async () => {
  const client = createAuthClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
});

export function authClientAvailable(): boolean {
  return createAuthClient() !== null;
}

export function devPasswordLoginEnabled(): boolean {
  return envString('EXPO_PUBLIC_DEV_LOGIN') === '1';
}

export async function loadDeviceId(): Promise<string> {
  const stored = await getSecret(DEVICE_KEY);
  if (stored) return stored;
  const created = randomUUID();
  await setSecret(DEVICE_KEY, created);
  return created;
}

export async function loadStoredSession(): Promise<ParentSession | null> {
  const raw = await getSecret(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ParentSession;
    if (typeof parsed.token !== 'string' || typeof parsed.tenantId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function persistSession(session: ParentSession): Promise<void> {
  await setSecret(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await deleteSecret(SESSION_KEY);
  const client = createAuthClient();
  if (client) await client.auth.signOut({ scope: 'local' });
}

function pickGuardian(
  memberships: Awaited<ReturnType<typeof fetchSession>>['memberships'],
  preferredTenantId?: string,
): { membershipId: string; tenantId: string } | null {
  const active = memberships.filter(
    (item) => item.status === 'ACTIVE' && item.roles.includes('GUARDIAN'),
  );
  const preferred = preferredTenantId
    ? active.find((item) => item.tenantId === preferredTenantId)
    : undefined;
  const chosen = preferred ?? active[0];
  if (!chosen) return null;
  return { membershipId: chosen.membershipId, tenantId: chosen.tenantId };
}

async function sessionFromToken(token: string, preferredTenantId?: string): Promise<ParentSession> {
  const snapshot = await fetchSession(token);
  const membership = pickGuardian(snapshot.memberships, preferredTenantId);
  if (!membership) {
    throw new ApiError(403, 'not_guardian', 'Bu hesapta veli üyeliği yok');
  }
  return {
    token,
    tenantId: membership.tenantId,
    fullName: snapshot.fullName,
    membershipId: membership.membershipId,
  };
}

export async function requestPhoneOtp(phone: string): Promise<string> {
  const e164 = toPhoneE164(phone);
  if (!e164) {
    throw new ApiError(400, 'invalid_phone', 'Telefon +90… biçiminde olmalı');
  }
  const client = createAuthClient();
  if (!client) {
    throw new ApiError(503, 'auth_unconfigured', 'Telefon OTP için Auth tanımlı değil');
  }
  const { error } = await client.auth.signInWithOtp({ phone: e164 });
  if (error) {
    throw new ApiError(401, 'unauthorized', error.message);
  }
  return e164;
}

async function verifyOtpAccessToken(phone: string, code: string): Promise<string> {
  const e164 = toPhoneE164(phone);
  if (!e164) {
    throw new ApiError(400, 'invalid_phone', 'Telefon +90… biçiminde olmalı');
  }
  const client = createAuthClient();
  if (!client) {
    throw new ApiError(503, 'auth_unconfigured', 'Telefon OTP için Auth tanımlı değil');
  }
  const { data, error } = await client.auth.verifyOtp({
    phone: e164,
    token: code.trim(),
    type: 'sms',
  });
  if (error || !data.session) {
    throw new ApiError(401, 'unauthorized', error?.message ?? 'Kod doğrulanamadı');
  }
  return data.session.access_token;
}

export async function verifyPhoneOtp(phone: string, code: string): Promise<ParentSession> {
  const access = await verifyOtpAccessToken(phone, code);
  const session = await sessionFromToken(access);
  await persistSession(session);
  return session;
}

/**
 * Davetli velinin ilk girişi. Sıra önemlidir: telefon OTP kimliği kanıtlar,
 * ardından davet jetonu bu kimliği kiracıdaki veli üyeliğine bağlar. Aktivasyon
 * olmadan `/v1/session` bu kişiye ACTIVE veli üyeliği göstermez — eski akışta
 * yeni veli tam da burada, "veli üyeliği yok" duvarına çarpıyordu.
 */
export async function activateInviteWithOtp(
  token: string,
  phone: string,
  code: string,
): Promise<ParentSession> {
  const access = await verifyOtpAccessToken(phone, code);
  await activateInvite(access, token);
  const session = await sessionFromToken(access);
  await persistSession(session);
  return session;
}

export async function loginWithPassword(phone: string, password: string): Promise<ParentSession> {
  const e164 = toPhoneE164(phone) ?? phone.trim();
  const token = (await devParentLogin(e164, password)).token;
  const session = await sessionFromToken(token);
  await persistSession(session);
  return session;
}

export async function restoreSession(): Promise<ParentSession | null> {
  const stored = await loadStoredSession();
  const client = createAuthClient();
  if (!client) return stored;
  const { data } = await client.auth.getSession();
  const access = data.session?.access_token;
  if (!access) return stored;
  try {
    const session = await sessionFromToken(access, stored?.tenantId);
    await persistSession(session);
    return session;
  } catch (caught) {
    // Yalnız taşıma hatasında (çevrimdışı) saklı oturuma düşülür. Yetki
    // kaldırıldıysa (401/403) saklı oturumu döndürmek, üyeliği iptal edilmiş
    // kişiyi uygulamanın içinde tutuyordu.
    if (caught instanceof ApiError && caught.status !== 0) {
      await clearSession();
      return null;
    }
    return stored;
  }
}
