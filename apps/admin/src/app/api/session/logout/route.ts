import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ADMIN_TENANT_COOKIE, ADMIN_TOKEN_COOKIE, adminCookieOptions } from '@/lib/auth-cookie';

export async function POST() {
  const store = await cookies();
  const options = adminCookieOptions();
  store.set(ADMIN_TOKEN_COOKIE, '', { ...options, maxAge: 0 });
  store.set(ADMIN_TENANT_COOKIE, '', { ...options, maxAge: 0 });
  return NextResponse.json({ ok: true });
}
