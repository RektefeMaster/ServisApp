'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

interface RouteRow {
  id: string;
  segment: string;
  schoolId: string;
  publishedVersionId: string | null;
  draftVersionId: string | null;
}

export default function RoutesPage() {
  const [items, setItems] = useState<RouteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiFetch<{ items: RouteRow[] }>('/v1/admin/routes')
      .then((body) => setItems(body.items))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Okunamadı'));
  }, []);
  return (
    <div>
      <h1 className="font-serif text-2xl">Rotalar</h1>
      <p className="mt-1 text-sm text-muted">Öğrenci araca değil rotaya bağlıdır. Yayın, mürettebat eksikliğini bloklamaz.</p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <ul className="mt-6 divide-y divide-rule border border-rule bg-white text-sm">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <Link href={`/routes/${item.id}`} className="underline">
              {item.segment === 'MORNING' ? 'Sabah' : 'Akşam'} rota
            </Link>
            <span className="ml-2 text-muted">
              {item.publishedVersionId ? 'yayınlı' : 'taslak'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
