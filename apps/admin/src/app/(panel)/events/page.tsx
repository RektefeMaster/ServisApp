'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { actorRoleLabel, eventTypeLabel, studentStateLabel, tripStateLabel } from '@/lib/labels';
import { shiftDay } from '@/lib/date';

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

interface EventRow {
  seq: number;
  occurredAt: string;
  eventType: string;
  subjectType: string;
  tripId: string | null;
  prevState: string | null;
  newState: string | null;
  actorRole: string | null;
}

export default function EventsPage() {
  const [date, setDate] = useState(todayYmd());
  const [loaded, setLoaded] = useState<{
    date: string;
    items: EventRow[];
    csv: string;
    error: string | null;
  }>({ date: '', items: [], csv: '', error: null });
  const loading = loaded.date !== date;
  const items = loading ? [] : loaded.items;
  const csv = loading ? '' : loaded.csv;
  const error = loading ? null : loaded.error;

  useEffect(() => {
    // Yarış koruması: eski yanıtın CSV'si yeni tarihin dosya adıyla
    // indirilebiliyordu.
    let cancelled = false;
    void apiFetch<{ available: true; items: EventRow[]; csv: string }>(
      `/v1/admin/events?date=${date}`,
    )
      .then((body) => {
        if (cancelled) return;
        setLoaded({ date, items: body.items, csv: body.csv, error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoaded({
          date,
          items: [],
          csv: '',
          error: caught instanceof Error ? caught.message : 'Olay listesi okunamadı',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  function downloadCsv() {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `olaylar-${date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Denetim izi</p>
      <h1 className="mt-1 font-serif text-3xl tracking-tight">Olaylar</h1>
      <p className="mt-1 max-w-xl text-sm text-muted">
        İşlemler zaman sırasıyla kaydedilir. CSV’de öğrenci adı, telefon ve olay açıklaması
        bulunmaz.
      </p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          aria-label="Önceki gün"
          disabled={!date}
          className="min-h-11 rounded-lg border border-field bg-white px-3 text-sm hover:bg-[#edf3ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
          onClick={() => setDate(shiftDay(date, -1))}
        >
          ←
        </button>
        <input
          type="date"
          aria-label="Olay tarihi"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="min-h-11 rounded-lg border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        />
        <button
          type="button"
          aria-label="Sonraki gün"
          disabled={!date}
          className="min-h-11 rounded-lg border border-field bg-white px-3 text-sm hover:bg-[#edf3ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
          onClick={() => setDate(shiftDay(date, 1))}
        >
          →
        </button>
        <button
          type="button"
          className="min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
          onClick={downloadCsv}
          disabled={!csv}
        >
          CSV indir
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <p role="status" className="mt-5 text-sm text-muted">
        {loading ? 'Olaylar yükleniyor…' : `${items.length} olay kaydı`}
      </p>
      <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white text-sm shadow-sm">
        {!loading && items.length === 0 ? (
          <li className="px-4 py-6 text-muted">Bu günde olay yok.</li>
        ) : (
          items.map((row) => (
            <li
              key={`${row.seq}-${row.occurredAt}`}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3"
            >
              <span className="text-muted">
                {new Date(row.occurredAt).toLocaleTimeString('tr-TR')}
              </span>
              <span className="font-medium">{eventTypeLabel(row.eventType)}</span>
              {row.newState
                ? ` · ${row.subjectType === 'TRIP' ? tripStateLabel(row.prevState) : studentStateLabel(row.prevState)} → ${row.subjectType === 'TRIP' ? tripStateLabel(row.newState) : studentStateLabel(row.newState)}`
                : ''}
              {row.actorRole ? (
                <span className="ml-auto text-xs text-muted">{actorRoleLabel(row.actorRole)}</span>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
