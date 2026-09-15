'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { segmentLabel, tripStateLabel } from '@/lib/labels';

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

interface PriorityRow {
  kind: string;
  severity: 'WARNING' | 'CRITICAL';
  tripId: string | null;
  plate: string | null;
  body: string;
}

const REFRESH_MS = 30_000;

export default function TodayPage() {
  const [items, setItems] = useState<TripRow[]>([]);
  const [priorities, setPriorities] = useState<PriorityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(todayYmd());

  /**
   * Sevkiyat ekranı düzenli tazelenir.
   *
   * Eskiden bir kez çekiliyordu: 07:00'de açılan ekran, 07:40'ta çıkan KRİTİK
   * bir uyarıyı (bozulan araç, eksik mürettebat, kaybolan konum) hiç
   * göstermiyordu. Gün de mount anında sabitlendiği için gece yarısını geçen
   * açık bir masa hâlâ dünü gösteriyordu.
   */
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      const today = todayYmd();
      setDate(today);
      void Promise.all([
        apiFetch<{ items: TripRow[] }>(`/v1/admin/trips?date=${today}`),
        apiFetch<{ items: PriorityRow[] }>(`/v1/admin/priorities?date=${today}`),
      ])
        .then(([trips, next]) => {
          if (cancelled) return;
          setItems(trips.items);
          setPriorities(next.items);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setError(caught instanceof Error ? caught.message : 'Okunamadı');
        });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onFocus = (): void => {
      load();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return (
    <div>
      <h1 className="font-serif text-2xl">Bugün</h1>
      <p className="mt-1 text-sm text-muted">{date} — önce müdahale gerekenler, sonra seferler.</p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <h2 className="mt-8 text-sm font-medium">Öncelikler</h2>
      <ul className="mt-2 divide-y divide-rule border border-rule bg-white">
        {priorities.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted">Bekleyen öncelik yok.</li>
        ) : (
          priorities.map((item, index) => (
            <li
              key={`${item.kind}-${item.tripId ?? item.body}-${index}`}
              className="px-4 py-3 text-sm"
            >
              <span className={item.severity === 'CRITICAL' ? 'text-red-700' : 'text-muted'}>
                {item.severity === 'CRITICAL' ? 'Kritik' : 'Uyarı'}
              </span>
              {' · '}
              {item.body}
              {item.tripId ? (
                <>
                  {' '}
                  <Link className="underline" href={`/trips/${item.tripId}`}>
                    Sefer
                  </Link>
                </>
              ) : null}
            </li>
          ))
        )}
      </ul>
      <ul className="mt-6 divide-y divide-rule border border-rule bg-white">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted">Bugün sefer yok.</li>
        ) : (
          items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm"
            >
              <span>
                {item.plate} · {item.schoolName} · {segmentLabel(item.segment)}
              </span>
              <Link className="underline" href={`/trips/${item.id}`}>
                {tripStateLabel(item.state)}
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
