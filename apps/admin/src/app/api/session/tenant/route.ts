import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiUrl } from '@/lib/api';
import {
  ADMIN_APP_VERSION,
  ADMIN_TENANT_COOKIE,
  ADMIN_TOKEN_COOKIE,
  adminCookieOptions,
  isUuid,
  sameOrigin,
} from '@/lib/auth-cookie';

interface SessionMembership {
  tenantId: string;
  status: string;
  roles: string[];
}

interface SessionBody {
  memberships?: SessionMembership[];
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden', message: 'Köken reddedildi' }, { status: 403 });
  }
  const store = await cookies();
  const token = store.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized', message: 'Oturum gerekli' }, { status: 401 });
  }
  const parsed = (await request.json().catch(() => null)) as { tenantId?: unknown } | null;
  const tenantId = typeof parsed?.tenantId === 'string' ? parsed.tenantId : '';
  if (!isUuid(tenantId)) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Şirket geçersiz' },
      { status: 400 },
    );
  }

  /**
   * Çerez, kullanıcının GERÇEKTEN yöneticisi olduğu bir şirkete yazılır.
   *
   * Eskiden yalnız UUID biçimi kontrol ediliyordu. API'nin ADMIN rol kapısı
   * sadece `/v1/admin/*` yollarında çalıştığı için, A şirketinde yönetici
   * B şirketinde şoför olan bir kimlik B'nin kimliğini çereze yazıp panelin
   * `/v1/trips/...` çağrılarını B şirketine karşı sürebiliyordu.
   */
  const sessionRes = await fetch(apiUrl('/v1/session'), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'x-client': 'admin',
      'x-app-version': ADMIN_APP_VERSION,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!sessionRes.ok) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Oturum doğrulanamadı' },
      { status: sessionRes.status === 403 ? 403 : 401 },
    );
  }
  const session = (await sessionRes.json().catch(() => ({}))) as SessionBody;
  const allowed = (session.memberships ?? []).some(
    (item) =>
      item.tenantId === tenantId && item.status === 'ACTIVE' && item.roles.includes('ADMIN'),
  );
  if (!allowed) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Bu şirkette yönetici üyeliğiniz yok' },
      { status: 403 },
    );
  }

  store.set(ADMIN_TENANT_COOKIE, tenantId, adminCookieOptions());
  return NextResponse.json({ ok: true });
}
