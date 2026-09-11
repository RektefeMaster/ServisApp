'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

interface TripRow {
  id: string;
  plate: string;
  schoolName: string;
  segment: string;
  state: string;
}

export default function TodayPage() {
  const [items, setItems] = useState<TripRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const date = todayYmd();

  useEffect(() => {
    void apiFetch<{ items: TripRow[] }>(`/v1/admin/trips?date=${date}`)
      .then((body) => setItems(body.items))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Okunamadı'));
  }, [date]);

  return (
    <div>
      <h1 className="font-serif text-2xl">Bugün</h1>
      <p className="mt-1 text-sm text-muted">{date} — öncelik kuyruğu sefer listesidir.</p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <ul className="mt-6 divide-y divide-rule border border-rule bg-white">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted">Bugün sefer yok.</li>
        ) : (
          items.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                {item.plate} · {item.schoolName} · {item.segment === 'MORNING' ? 'Sabah' : 'Akşam'}
              </span>
              <Link className="underline" href={`/trips/${item.id}`}>
                {item.state}
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
