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
  serviceDate: string;
}

export default function TripsPage() {
  const [date, setDate] = useState(todayYmd());
  const [items, setItems] = useState<TripRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    void apiFetch<{ items: TripRow[] }>(`/v1/admin/trips?date=${date}`)
      .then((body) => setItems(body.items))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Okunamadı'));
  }, [date]);

  async function generate() {
    try {
      const body = await apiFetch<{ created: number; skipped: number }>('/v1/admin/trips/generate', {
        method: 'POST',
        body: JSON.stringify({ fromDate: date }),
      });
      setMessage(`${body.created} sefer üretildi, ${body.skipped} atlandı`);
      const listed = await apiFetch<{ items: TripRow[] }>(`/v1/admin/trips?date=${date}`);
      setItems(listed.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Üretim başarısız');
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">Seferler</h1>
      <div className="mt-4 flex gap-3">
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="rounded border border-rule bg-white px-2 py-1 text-sm"
        />
        <button type="button" className="rounded bg-ink px-3 py-1 text-sm text-paper" onClick={() => void generate()}>
          Ufuk üret
        </button>
      </div>
      {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <ul className="mt-6 divide-y divide-rule border border-rule bg-white">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-3 text-sm">
            <Link href={`/trips/${item.id}`} className="underline">
              {item.plate} · {item.schoolName} · {item.state}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
