import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiUrl } from '@/lib/api';
import {
  ADMIN_APP_VERSION,
  ADMIN_TENANT_COOKIE,
  ADMIN_TOKEN_COOKIE,
  sameOrigin,
} from '@/lib/auth-cookie';

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'cookie',
  'authorization',
  'host',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
]);

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request)) {
    return NextResponse.json({ error: 'forbidden', message: 'Köken reddedildi' }, { status: 403 });
  }
  const { path } = await context.params;
  if (
    path.length === 0 ||
    path.some((segment) => segment.length === 0 || segment.includes('/') || segment.includes('..'))
  ) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const store = await cookies();
  const token = store.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'unauthorized', message: 'Oturum gerekli' }, { status: 401 });
  }
  const tenantId = store.get(ADMIN_TENANT_COOKIE)?.value;
  const search = new URL(request.url).search;
  const target = apiUrl(`/v1/${path.join('/')}${search}`);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set('authorization', `Bearer ${token}`);
  headers.set('x-client', 'admin');
  headers.set('x-app-version', ADMIN_APP_VERSION);
  headers.set('accept', 'application/json');
  if (tenantId) headers.set('x-tenant-id', tenantId);
  else headers.delete('x-tenant-id');

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }
  const upstream = await fetch(target, init);
  const body = await upstream.arrayBuffer();
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);
  return new NextResponse(body, { status: upstream.status, headers: responseHeaders });
}

export function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}

export function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}

export function PUT(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}

export function PATCH(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}

export function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(request, context);
}
