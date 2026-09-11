'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { discardLegacyBrowserToken, type SessionBody } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@demo.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    discardLegacyBrowserToken();
    try {
      const login = await fetch('/api/session/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email, password }),
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="font-serif text-3xl">ServisApp</p>
      <p className="mt-2 text-sm text-muted">Saha masası — kayıt admin’de, veli yalnız aktive olur.</p>
      <form onSubmit={(event) => void submit(event)} className="mt-8 flex flex-col gap-3">
        <label className="text-sm">
          E-posta
          <input
            className="mt-1 w-full rounded border border-rule bg-white px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="text-sm">
          Parola
          <input
            type="password"
            className="mt-1 w-full rounded border border-rule bg-white px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-2 rounded bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
        >
          {busy ? 'Giriliyor…' : 'Giriş'}
        </button>
      </form>
    </main>
  );
}
