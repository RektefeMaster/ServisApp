import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { ApiError, devParentLogin, fetchSession, type ParentSession } from './api/client';

const SESSION_KEY = 'parent.session';

function createAuthClient(): ReturnType<typeof createClient> | null {
  const url = process.env['EXPO_PUBLIC_SUPABASE_URL'];
  const publishableKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !publishableKey) return null;
  return createClient(url, publishableKey, {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export async function loadStoredSession(): Promise<ParentSession | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
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
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
  const client = createAuthClient();
  if (client) await client.auth.signOut();
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

export async function loginWithPassword(phone: string, password: string): Promise<ParentSession> {
  const token = (await devParentLogin(phone, password)).token;
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
  } catch {
    return stored;
  }
}
