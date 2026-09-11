const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ADMIN_APP_VERSION = '99.0.0';

export const ADMIN_TOKEN_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-servisapp.admin' : 'servisapp.admin';

export const ADMIN_TENANT_COOKIE =
  process.env.NODE_ENV === 'production'
    ? '__Host-servisapp.admin.tenant'
    : 'servisapp.admin.tenant';

export function adminCookieOptions(): {
  httpOnly: true;
  sameSite: 'strict';
  secure: boolean;
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  };
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return request.method === 'GET' || request.method === 'HEAD';
  }
  const host = request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
