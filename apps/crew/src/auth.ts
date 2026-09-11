import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import {
  ApiError,
  devLogin,
  fetchSession,
  type CrewSession,
} from './api/client';
import { deleteSecret, getSecret, setSecret } from './secure-storage';

const SESSION_KEY = 'crew.session';
const DEVICE_KEY = 'crew.deviceId';
const LAST_TRIP_KEY = 'crew.lastTripId';

function createAuthClient(): ReturnType<typeof createClient> | null {
  const url = process.env['EXPO_PUBLIC_SUPABASE_URL'];
  const publishableKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !publishableKey) return null;
  return createClient(url, publishableKey, {
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
}

export async function loadDeviceId(): Promise<string> {
  const stored = await getSecret(DEVICE_KEY);
  if (stored) return stored;
  const created = randomUUID();
  await setSecret(DEVICE_KEY, created);
  return created;
}

export async function loadStoredSession(): Promise<CrewSession | null> {
  const raw = await getSecret(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CrewSession;
    if (typeof parsed.token !== 'string' || typeof parsed.tenantId !== 'string') return null;
    parsed.deviceId = await loadDeviceId();
    return parsed;
  } catch {
    return null;
  }
}

export async function persistSession(session: CrewSession): Promise<void> {
  await setSecret(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await deleteSecret(SESSION_KEY);
  const client = createAuthClient();
  if (client) await client.auth.signOut();
}

export async function loadLastTripId(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_TRIP_KEY);
}

export async function persistLastTripId(tripId: string): Promise<void> {
  await AsyncStorage.setItem(LAST_TRIP_KEY, tripId);
}

export type CrewMembershipChoice = {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  roles: CrewSession['roles'];
};

export type PasswordLoginResult =
  | { status: 'ready'; session: CrewSession }
  | { status: 'choose'; token: string; fullName: string; memberships: CrewMembershipChoice[] };

function crewMemberships(
  memberships: Awaited<ReturnType<typeof fetchSession>>['memberships'],
): CrewMembershipChoice[] {
  return memberships
    .filter((item) => item.status === 'ACTIVE')
    .filter(
      (item) =>
        item.roles.includes('DRIVER') ||
        item.roles.includes('ATTENDANT') ||
        item.roles.includes('ADMIN'),
    )
    .map((item) => ({
      membershipId: item.membershipId,
      tenantId: item.tenantId,
      tenantName: item.tenantName,
      roles: item.roles,
    }));
}

function pickCrewMembership(
  memberships: CrewMembershipChoice[],
  preferredTenantId?: string,
): CrewMembershipChoice | null {
  if (preferredTenantId) {
    const preferred = memberships.find((item) => item.tenantId === preferredTenantId);
    if (preferred) return preferred;
  }
  return (
    memberships.find((item) => item.roles.includes('DRIVER') || item.roles.includes('ATTENDANT')) ??
    memberships.find((item) => item.roles.includes('ADMIN')) ??
    null
  );
}

async function sessionFromMembership(
  token: string,
  fullName: string,
  membership: CrewMembershipChoice,
): Promise<CrewSession> {
  return {
    token,
    tenantId: membership.tenantId,
    fullName,
    membershipId: membership.membershipId,
    roles: membership.roles,
    deviceId: await loadDeviceId(),
  };
}

async function sessionFromToken(token: string, preferredTenantId?: string): Promise<CrewSession> {
  const snapshot = await fetchSession(token);
  const membership = pickCrewMembership(crewMemberships(snapshot.memberships), preferredTenantId);
  if (!membership) {
    throw new ApiError(403, 'not_crew', 'Bu hesapta şoför veya hostes üyeliği yok');
  }
  return sessionFromMembership(token, snapshot.fullName, membership);
}

export async function loginWithPassword(email: string, password: string): Promise<PasswordLoginResult> {
  const client = createAuthClient();
  let token: string;
  if (client) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      throw new ApiError(401, 'unauthorized', error?.message ?? 'Giriş başarısız');
    }
    token = data.session.access_token;
  } else {
    token = (await devLogin(email, password)).token;
  }
  const snapshot = await fetchSession(token);
  const memberships = crewMemberships(snapshot.memberships);
  if (memberships.length === 0) {
    throw new ApiError(403, 'not_crew', 'Bu hesapta şoför veya hostes üyeliği yok');
  }
  if (memberships.length > 1) {
    return { status: 'choose', token, fullName: snapshot.fullName, memberships };
  }
  const chosen = memberships[0];
  if (!chosen) {
    throw new ApiError(403, 'not_crew', 'Bu hesapta şoför veya hostes üyeliği yok');
  }
  const session = await sessionFromMembership(token, snapshot.fullName, chosen);
  await persistSession(session);
  return { status: 'ready', session };
}

export async function finishMembershipChoice(
  token: string,
  fullName: string,
  membership: CrewMembershipChoice,
): Promise<CrewSession> {
  const session = await sessionFromMembership(token, fullName, membership);
  await persistSession(session);
  return session;
}

export async function restoreSupabaseSession(): Promise<CrewSession | null> {
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
