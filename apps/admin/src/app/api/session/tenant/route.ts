import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  ADMIN_TENANT_COOKIE,
  ADMIN_TOKEN_COOKIE,
  adminCookieOptions,
  isUuid,
  sameOrigin,
} from '@/lib/auth-cookie';

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden', message: 'Köken reddedildi' }, { status: 403 });
  }
  const store = await cookies();
  if (!store.get(ADMIN_TOKEN_COOKIE)?.value) {
    return NextResponse.json({ error: 'unauthorized', message: 'Oturum gerekli' }, { status: 401 });
  }
  const parsed = (await request.json().catch(() => null)) as { tenantId?: unknown } | null;
  const tenantId = typeof parsed?.tenantId === 'string' ? parsed.tenantId : '';
  if (!isUuid(tenantId)) {
    return NextResponse.json({ error: 'invalid_body', message: 'Şirket geçersiz' }, { status: 400 });
  }
  store.set(ADMIN_TENANT_COOKIE, tenantId, adminCookieOptions());
  return NextResponse.json({ ok: true });
}
