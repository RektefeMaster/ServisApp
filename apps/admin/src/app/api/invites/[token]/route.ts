import { NextResponse } from 'next/server';
import { apiUrl } from '@/lib/api';
import { ADMIN_APP_VERSION } from '@/lib/auth-cookie';

/**
 * Davet önizlemesi için aynı köken üzerinden geçen açık uç.
 *
 * Davet sayfası API'ye doğrudan gidiyordu: veli SMS linkini ofis ağının dışında
 * açtığında istek ya ulaşılamayan bir adrese gidiyor, ya https sayfadan http
 * API'ye karışık içerik olarak engelleniyor, ya da CORS'a takılıyordu. Sayfa bu
 * hataları "Bu davet artık kullanılamaz." diye gösterdiği için geçerli bir
 * davet iptal edilmiş gibi görünüyordu.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  if (!token || token.includes('/') || token.length > 200) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    const upstream = await fetch(apiUrl(`/v1/invites/${encodeURIComponent(token)}`), {
      headers: { accept: 'application/json', 'x-app-version': ADMIN_APP_VERSION },
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'upstream_unavailable', message: 'Davet şu an okunamıyor, tekrar deneyin' },
      { status: 503 },
    );
  }
}
