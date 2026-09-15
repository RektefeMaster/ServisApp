'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiFetch, clearSession, setTenant, type SessionBody } from '@/lib/session';

const NAV = [
  { href: '/today', label: 'Bugün' },
  { href: '/trips', label: 'Seferler' },
  { href: '/routes', label: 'Rotalar' },
  { href: '/places', label: 'Adres ve durak' },
  { href: '/schools', label: 'Okullar' },
  { href: '/students', label: 'Öğrenciler' },
  { href: '/fleet', label: 'Filo' },
  { href: '/exceptions', label: 'İstisnalar' },
  { href: '/events', label: 'Olaylar' },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSessionState] = useState<SessionBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let alive = true;
    void apiFetch<SessionBody>('/v1/session')
      .then(async (body) => {
        const adminMemberships = body.memberships.filter(
          (item) => item.roles.includes('ADMIN') && item.status === 'ACTIVE',
        );
        if (adminMemberships.length === 0) {
          await clearSession();
          router.replace('/login');
          return;
        }
        const current = body.membership?.tenantId;
        const next =
          adminMemberships.find((item) => item.tenantId === current) ?? adminMemberships[0];
        if (next && next.tenantId !== current) {
          await setTenant(next.tenantId);
          const refreshed = await apiFetch<SessionBody>('/v1/session');
          if (alive) setSessionState(refreshed);
          return;
        }
        if (alive) setSessionState(body);
      })
      .catch((caught: unknown) => {
        // Yalnız yetki hatası oturumu kapatır. Eskiden her hata — API'nin on
        // saniyelik yeniden dağıtımı, tek bir Wi-Fi kesintisi — sevkiyatın
        // ortasında operatörü dışarı atıp çerezleri siliyordu.
        const status = caught instanceof ApiError ? caught.status : 0;
        if (alive) setError(caught instanceof Error ? caught.message : 'Oturum okunamadı');
        if (status === 401 || status === 403) {
          void clearSession().then(() => router.replace('/login'));
        }
      });
    return () => {
      alive = false;
    };
  }, [router, attempt]);

  const adminTenants = (session?.memberships ?? []).filter(
    (item) => item.roles.includes('ADMIN') && item.status === 'ACTIVE',
  );

  const switchTenant = useCallback(async (tenantId: string) => {
    setSwitching(true);
    try {
      await setTenant(tenantId);
      // Panel sayfaları veriyi kendi mount'larında çekiyor; şirket değişince
      // tam yenileme en dürüst davranış: ekranda karışık kiracı verisi kalmaz.
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  }, []);

  if (error && !session) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="font-serif text-xl">Panel açılamadı</h1>
        <p className="mt-2 text-sm text-muted">{error}</p>
        <button
          type="button"
          className="mt-4 rounded border border-rule bg-white px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          onClick={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        >
          Tekrar dene
        </button>
      </main>
    );
  }
  if (!session) {
    return (
      <p className="p-8 text-sm text-muted" role="status">
        Yükleniyor…
      </p>
    );
  }

  const nav = (
    <nav aria-label="Panel bölümleri" className="flex flex-col gap-0.5 p-2">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            // Dar ekranda seçimden sonra menü kapanır; açık kalırsa içeriği
            // kaplamaya devam ediyordu.
            onClick={() => setMenuOpen(false)}
            className={`rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
              active ? 'bg-ink text-paper' : 'text-ink hover:bg-rule/40'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="lg:flex lg:min-h-screen">
      <a
        href="#panel-icerik"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
      >
        İçeriğe geç
      </a>

      {/* Dar ekran: sabit yan sütun 224 puntoyu yiyor ve içeriğe yer kalmıyordu. */}
      <header className="flex items-center justify-between border-b border-rule bg-white/70 px-4 py-3 lg:hidden">
        <p className="font-serif text-lg tracking-tight">ServisApp</p>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="panel-menu"
          className="rounded border border-rule px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          onClick={() => setMenuOpen((value) => !value)}
        >
          {menuOpen ? 'Kapat' : 'Menü'}
        </button>
      </header>

      <aside
        id="panel-menu"
        className={`${menuOpen ? 'block' : 'hidden'} border-b border-rule bg-white/70 lg:block lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r`}
      >
        <div className="hidden border-b border-rule px-4 py-5 lg:block">
          <p className="font-serif text-lg tracking-tight">ServisApp</p>
          <p className="mt-1 text-xs text-muted">{session.fullName}</p>
        </div>

        {adminTenants.length > 1 ? (
          <div className="border-b border-rule px-4 py-3">
            <label className="block text-xs text-muted" htmlFor="tenant-switch">
              Şirket
            </label>
            <select
              id="tenant-switch"
              className="mt-1 w-full rounded border border-rule bg-white px-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={session.membership?.tenantId ?? ''}
              disabled={switching}
              onChange={(event) => {
                void switchTenant(event.target.value);
              }}
            >
              {adminTenants.map((item) => (
                <option key={item.tenantId} value={item.tenantId}>
                  {item.tenantName}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {nav}

        <button
          type="button"
          className="w-full border-t border-rule px-4 py-3 text-left text-sm text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          onClick={() => {
            void clearSession().then(() => router.replace('/login'));
          }}
        >
          Çıkış
        </button>
      </aside>

      <main id="panel-icerik" className="flex-1 p-4 lg:p-8">
        {children}
      </main>
    </div>
  );
}
