'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { segmentLabel, tripStateLabel } from '@/lib/labels';
import { shiftDay } from '@/lib/date';

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
  const activeDateRef = useRef(date);
  const [loaded, setLoaded] = useState<{ date: string; items: TripRow[]; error: string | null }>({
    date: '',
    items: [],
    error: null,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loading = loaded.date !== date;
  const items = loading ? [] : loaded.items;
  const error = loading ? null : loaded.error;

  function selectDate(next: string) {
    setMessage(null);
    activeDateRef.current = next;
    setDate(next);
  }

  useEffect(() => {
    // Tarih ileri geri gezilirken yavaş yanıt yenisini ezebiliyordu: başlık
    // 20 Eylül'ü gösterirken liste 13 Eylül'ün seferleri oluyordu.
    let cancelled = false;
    void apiFetch<{ items: TripRow[] }>(`/v1/admin/trips?date=${date}`)
      .then((body) => {
        if (cancelled) return;
        setLoaded({ date, items: body.items, error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoaded({
          date,
          items: [],
          error: caught instanceof Error ? caught.message : 'Okunamadı',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function generate() {
    if (busy) return;
    const requestedDate = date;
    setBusy(true);
    setLoaded({ date: '', items: [], error: null });
    setMessage(null);
    try {
      const body = await apiFetch<{ created: number; skipped: number }>(
        '/v1/admin/trips/generate',
        {
          method: 'POST',
          body: JSON.stringify({ fromDate: requestedDate }),
        },
      );
      if (activeDateRef.current !== requestedDate) return;
      setMessage(`${body.created} sefer üretildi, ${body.skipped} atlandı`);
      const listed = await apiFetch<{ items: TripRow[] }>(`/v1/admin/trips?date=${requestedDate}`);
      if (activeDateRef.current === requestedDate)
        setLoaded({ date: requestedDate, items: listed.items, error: null });
    } catch (caught) {
      if (activeDateRef.current === requestedDate)
        setLoaded({
          date: requestedDate,
          items: [],
          error: caught instanceof Error ? caught.message : 'Üretim başarısız',
        });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Günlük plan</p>
      <h1 className="mt-1 font-serif text-3xl tracking-tight">Seferler</h1>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          aria-label="Önceki gün"
          disabled={!date}
          className="min-h-11 rounded-lg border border-field bg-white px-3 text-sm hover:bg-[#edf3ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
          onClick={() => selectDate(shiftDay(date, -1))}
        >
          ←
        </button>
        <input
          type="date"
          aria-label="Sefer tarihi"
          value={date}
          onChange={(event) => selectDate(event.target.value)}
          className="min-h-11 rounded-lg border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        />
        <button
          type="button"
          aria-label="Sonraki gün"
          disabled={!date}
          className="min-h-11 rounded-lg border border-field bg-white px-3 text-sm hover:bg-[#edf3ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
          onClick={() => selectDate(shiftDay(date, 1))}
        >
          →
        </button>
        <button
          type="button"
          disabled={busy || !date}
          className="min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-[#33524d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          onClick={() => void generate()}
        >
          {busy ? 'Üretiliyor…' : 'Seferleri üret'}
        </button>
      </div>
      {message ? (
        <p role="status" className="mt-3 rounded-lg bg-[#eaf0ed] px-4 py-3 text-sm text-ink">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <p role="status" className="mt-6 text-sm text-muted">
        {loading ? 'Seferler yükleniyor…' : `${items.length} sefer`}
      </p>
      <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white shadow-sm">
        {!loading && items.length === 0 ? (
          <li className="px-5 py-6 text-sm text-muted">
            Bu tarihte sefer yok. Yayınlı rota varsa seferleri üretebilirsiniz.
          </li>
        ) : null}
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm"
          >
            <div>
              <p className="font-medium">
                {item.plate} · {item.schoolName}
              </p>
              <p className="mt-1 text-xs text-muted">
                {segmentLabel(item.segment)} · {item.serviceDate}
              </p>
            </div>
            <Link
              href={`/trips/${item.id}`}
              className="rounded-lg border border-rule px-3 py-2 font-medium hover:bg-[#edf3ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {tripStateLabel(item.state)} · Detay
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
