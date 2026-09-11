'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

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
  const [items, setItems] = useState<EventRow[]>([]);
  const [csv, setCsv] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ available: true; items: EventRow[]; csv: string }>(
      `/v1/admin/events?date=${date}`,
    )
      .then((body) => {
        setItems(body.items);
        setCsv(body.csv);
        setError(null);
      })
      .catch((caught: unknown) => {
        setItems([]);
        setCsv('');
        setError(caught instanceof Error ? caught.message : 'Olay listesi okunamadı');
      });
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
      <h1 className="font-serif text-2xl">Olaylar</h1>
      <p className="mt-1 max-w-xl text-sm text-muted">
        Append-only denetim izi. CSV’de öğrenci adı, telefon ve olay gövdesi yoktur.
      </p>
      <div className="mt-4 flex gap-3">
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="rounded border border-rule bg-white px-2 py-1 text-sm"
        />
        <button
          type="button"
          className="rounded bg-ink px-3 py-1 text-sm text-paper disabled:opacity-40"
          onClick={downloadCsv}
          disabled={!csv}
        >
          CSV indir
        </button>
      </div>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <ul className="mt-6 divide-y divide-rule border border-rule bg-white text-sm">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-muted">Bu günde olay yok.</li>
        ) : (
          items.map((row) => (
            <li key={`${row.seq}-${row.occurredAt}`} className="px-4 py-2">
              <span className="text-muted">{new Date(row.occurredAt).toLocaleTimeString('tr-TR')}</span>
              {' · '}
              {row.eventType}
              {row.newState ? ` · ${row.prevState ?? '—'} → ${row.newState}` : ''}
              {row.actorRole ? ` · ${row.actorRole}` : ''}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
