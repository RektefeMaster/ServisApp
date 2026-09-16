'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { discardLegacyBrowserToken, type SessionBody } from '@/lib/session';
import { authConfigured, signInWithPassword } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    discardLegacyBrowserToken();
    try {
      // Supabase kuruluysa kimlik doğrulaması orada yapılır ve yalnız jeton
      // sunucuya verilir; jeton httpOnly çerezle takas edilir. Yerel kurulumda
      // Supabase yoksa geliştirici parola yolu kullanılır.
      const payload = authConfigured()
        ? { accessToken: await signInWithPassword(email, password) }
        : { email, password };
      const login = await fetch('/api/session/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await login.json()) as SessionBody & { message?: string; error?: string };
      if (!login.ok) {
        throw new Error(body.message ?? 'Giriş başarısız');
      }
      if (!Array.isArray(body.memberships)) {
        throw new Error('Oturum yanıtı geçersiz');
      }
      const admin = body.memberships.find(
        (item) => item.roles.includes('ADMIN') && item.status === 'ACTIVE',
      );
      if (!admin) throw new Error('Bu hesapta yönetici üyeliği yok');
      router.replace('/today');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Giriş başarısız');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-10">
      <div className="rounded-3xl border border-rule bg-white p-7 shadow-lg shadow-[#253a38]/5 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
          Operasyon merkezi
        </p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight">ServisApp</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Seferleri, öğrencileri ve saha kararlarını tek yerden yönetin.
        </p>
        <form onSubmit={(event) => void submit(event)} className="mt-8 flex flex-col gap-4">
          <label className="text-sm">
            E-posta
            <input
              className="mt-1 min-h-11 w-full rounded-lg border border-field bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="text-sm">
            Parola
            <input
              type="password"
              className="mt-1 min-h-11 w-full rounded-lg border border-field bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="mt-2 min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-[#33524d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          >
            {busy ? 'Giriliyor…' : 'Giriş'}
          </button>
        </form>
      </div>
    </main>
  );
}
