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
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

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
    let latest = 0;
    const load = (): void => {
      const requestId = ++latest;
      const today = todayYmd();
      setDate(today);
      setLoading(true);
      void Promise.all([
        apiFetch<{ items: TripRow[] }>(`/v1/admin/trips?date=${today}`),
        apiFetch<{ items: PriorityRow[] }>(`/v1/admin/priorities?date=${today}`),
      ])
        .then(([trips, next]) => {
          if (cancelled || requestId !== latest) return;
          setItems(trips.items);
          setPriorities(next.items);
          setError(null);
          setUpdatedAt(new Date());
        })
        .catch((caught: unknown) => {
          if (cancelled || requestId !== latest) return;
          setError(caught instanceof Error ? caught.message : 'Okunamadı');
        })
        .finally(() => {
          if (!cancelled && requestId === latest) setLoading(false);
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
  }, [reload]);

  const activeCount = items.filter((item) => item.state === 'ACTIVE').length;
  const criticalCount = priorities.filter((item) => item.severity === 'CRITICAL').length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Sevkiyat masası
          </p>
          <h1 className="mt-1 font-serif text-3xl tracking-tight sm:text-4xl">Bugün</h1>
          <p className="mt-1 text-sm text-muted">{date} · Müdahale gerekenler ve günün seferleri</p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setReload((value) => value + 1)}
          className="min-h-11 rounded-lg border border-field bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-[#edf3ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
        >
          {loading ? 'Yenileniyor…' : 'Verileri yenile'}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted" role="status">
        {updatedAt
          ? `Son başarılı güncelleme ${updatedAt.toLocaleTimeString('tr-TR')}`
          : 'Veriler yükleniyor…'}
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-700/20 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error} · Son başarılı veriler gösteriliyor.
        </p>
      ) : null}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Günlük sefer', value: items.length },
          { label: 'Yoldaki sefer', value: activeCount },
          { label: 'Kritik öncelik', value: criticalCount },
        ].map((metric) => (
          <div
            key={metric.label}
            className="rounded-xl border border-rule bg-white px-5 py-4 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              {metric.label}
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">{metric.value}</p>
          </div>
        ))}
      </div>
      <h2 className="mt-9 font-serif text-xl">Öncelikler</h2>
      <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white shadow-sm">
        {priorities.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted">Bekleyen öncelik yok.</li>
        ) : (
          priorities.map((item, index) => (
            <li
              key={`${item.kind}-${item.tripId ?? item.body}-${index}`}
              className="px-4 py-3 text-sm"
            >
              <span
                className={`mr-2 inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${item.severity === 'CRITICAL' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-[#8b4c13]'}`}
              >
                {item.severity === 'CRITICAL' ? 'Kritik' : 'Uyarı'}
              </span>{' '}
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
      <h2 className="mt-9 font-serif text-xl">Seferler</h2>
      <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white shadow-sm">
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
              <Link
                className="rounded-lg border border-rule px-3 py-2 font-medium hover:bg-[#edf3ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                href={`/trips/${item.id}`}
              >
                {tripStateLabel(item.state)} · Detay
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
