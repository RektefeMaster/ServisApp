'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Yalnız Auth. Tablolara ve service_role anahtarına tarayıcıdan gidilmez. */
let client: SupabaseClient | null = null;

function url(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function publishableKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function authConfigured(): boolean {
  return Boolean(url() && publishableKey());
}

/**
 * Tek örnek. Her çağrıda yeni istemci kurmak, her birinin kendi jeton yenileme
 * zamanlayıcısını çalıştırması demekti.
 */
export function createAuthClient(): SupabaseClient {
  if (client) return client;
  const configuredUrl = url();
  const configuredKey = publishableKey();
  if (!configuredUrl || !configuredKey) {
    throw new Error('Supabase Auth ayarları eksik');
  }
  client = createClient(configuredUrl, configuredKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Tarayıcıdaki oturumdan güncel erişim jetonunu verir. */
export async function currentAccessToken(): Promise<string | null> {
  if (!authConfigured()) return null;
  const { data } = await createAuthClient().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithPassword(email: string, password: string): Promise<string> {
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(error?.message ?? 'E-posta veya parola hatalı');
  }
  return data.session.access_token;
}

export async function signOutAuth(): Promise<void> {
  if (!authConfigured()) return;
  await createAuthClient().auth.signOut({ scope: 'local' });
}
