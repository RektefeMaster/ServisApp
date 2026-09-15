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

interface DevLoginBody {
  token?: string;
  message?: string;
}

interface SessionMembership {
  tenantId: string;
  status: string;
  roles: string[];
}

interface SessionBody {
  fullName?: string;
  memberships?: SessionMembership[];
  message?: string;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden', message: 'Köken reddedildi' }, { status: 403 });
  }
  const parsed = (await request.json().catch(() => null)) as {
    email?: unknown;
    password?: unknown;
    accessToken?: unknown;
  } | null;

  /**
   * İki yol vardır ve ikisi de gereklidir:
   *  - Üretim: tarayıcı Supabase Auth ile giriş yapar, jetonu buraya verir ve
   *    biz onu httpOnly çerezle takas ederiz. (Eskiden bu yol hiç yoktu; panel
   *    yalnız `/v1/dev/login` çağırıyordu ve o uç üretimde HİÇ kayıtlı değil —
   *    yani üretimde hiçbir yönetici panele giremiyordu.)
   *  - Yerel geliştirme: Supabase kurulu değilken e-posta + parola.
   */
  const accessToken = typeof parsed?.accessToken === 'string' ? parsed.accessToken : '';
  let token = accessToken;

  if (!token) {
    const email = typeof parsed?.email === 'string' ? parsed.email : '';
    const password = typeof parsed?.password === 'string' ? parsed.password : '';
    if (!email || !password) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Giriş başarısız' },
        { status: 400 },
      );
    }
    const login = await fetch(apiUrl('/v1/dev/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = (await login.json().catch(() => ({}))) as DevLoginBody;
    if (!login.ok || typeof loginBody.token !== 'string') {
      return NextResponse.json(
        { error: 'unauthorized', message: loginBody.message ?? 'Giriş başarısız' },
        { status: login.status === 401 || login.status === 403 ? 401 : login.status },
      );
    }
    token = loginBody.token;
  }

  const sessionRes = await fetch(apiUrl('/v1/session'), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'x-client': 'admin',
      'x-app-version': ADMIN_APP_VERSION,
    },
  });
  const session = (await sessionRes.json().catch(() => ({}))) as SessionBody;
  if (!sessionRes.ok || !Array.isArray(session.memberships)) {
    return NextResponse.json(
      { error: 'unauthorized', message: session.message ?? 'Oturum açılamadı' },
      { status: sessionRes.status === 401 || sessionRes.status === 403 ? 401 : sessionRes.status },
    );
  }
  const admin = session.memberships.find(
    (item) => item.roles.includes('ADMIN') && item.status === 'ACTIVE',
  );
  if (!admin || !isUuid(admin.tenantId)) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Bu hesapta yönetici üyeliği yok' },
      { status: 401 },
    );
  }

  const cookie = adminCookieOptions();
  const response = NextResponse.json({
    fullName: session.fullName ?? '',
    memberships: session.memberships,
  });
  response.cookies.set(ADMIN_TOKEN_COOKIE, token, cookie);
  response.cookies.set(ADMIN_TENANT_COOKIE, admin.tenantId, cookie);
  return response;
}
