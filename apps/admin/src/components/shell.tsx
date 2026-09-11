'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { apiFetch, clearSession, setTenant, type SessionBody } from '@/lib/session';

const NAV = [
  { href: '/today', label: 'Bugün' },
  { href: '/trips', label: 'Seferler' },
  { href: '/routes', label: 'Rotalar' },
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

  useEffect(() => {
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
          setSessionState(await apiFetch<SessionBody>('/v1/session'));
          return;
        }
        setSessionState(body);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Oturum yok');
        void clearSession().then(() => router.replace('/login'));
      });
  }, [router]);

  if (error && !session) {
    return <p className="p-8 text-sm text-muted">{error}</p>;
  }
  if (!session) {
    return <p className="p-8 text-sm text-muted">Yükleniyor…</p>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-rule bg-white/70">
        <div className="border-b border-rule px-4 py-5">
          <p className="font-serif text-lg tracking-tight">ServisApp</p>
          <p className="mt-1 text-xs text-muted">{session.fullName}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm ${
                  active ? 'bg-ink text-paper' : 'text-ink hover:bg-rule/40'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          className="border-t border-rule px-4 py-3 text-left text-sm text-muted"
          onClick={() => {
            void clearSession().then(() => router.replace('/login'));
          }}
        >
          Çıkış
        </button>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
