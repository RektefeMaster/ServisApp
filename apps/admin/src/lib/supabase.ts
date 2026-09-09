'use client';

import { createClient } from '@supabase/supabase-js';

/** Yalnız Auth. Tablolara ve service_role anahtarına tarayıcıdan gidilmez. */
export function createAuthClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !publishableKey) {
    throw new Error('Supabase Auth ayarları eksik');
  }
  return createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
