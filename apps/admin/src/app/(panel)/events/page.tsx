'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

export default function EventsPage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiFetch<{ available: boolean }>('/v1/admin/events')
      .then((body) => {
        setAvailable(body.available);
        setError(null);
      })
      .catch((caught: unknown) => {
        setAvailable(null);
        setError(caught instanceof Error ? caught.message : 'Olay listesi okunamadı');
      });
  }, []);
  return (
    <div>
      <h1 className="font-serif text-2xl">Olaylar</h1>
      <p className={`mt-4 max-w-xl text-sm ${error ? 'text-red-700' : 'text-muted'}`}>
        {error
          ? error
          : available === null
            ? 'Yükleniyor…'
            : available
              ? 'Olay listesi bağlı; bu dalgada satır yüzeyi yok. Uydurma kayıt gösterilmez.'
              : 'Olay listesi API’si henüz yok. Kayıtlar append-only event tablosunda duruyor; bu ekran uydurma satır göstermez.'}
      </p>
    </div>
  );
}
