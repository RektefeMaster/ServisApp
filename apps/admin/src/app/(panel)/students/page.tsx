'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

interface StudentRow {
  id: string;
  fullName: string;
  schoolName: string;
  morningPlanStatus: string;
  eveningPlanStatus: string;
  addressVerification: string;
}

export default function StudentsPage() {
  const [items, setItems] = useState<StudentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiFetch<{ items: StudentRow[] }>('/v1/admin/students')
      .then((body) => setItems(body.items))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Okunamadı'));
  }, []);
  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-2xl">Öğrenciler</h1>
          <p className="mt-1 text-sm text-muted">Davet kişi sayısına göre gider; çocuk sayısı SMS üretmez.</p>
        </div>
        <Link href="/students/import" className="text-sm underline">
          İçe aktar
        </Link>
      </div>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <ul className="mt-6 divide-y divide-rule border border-rule bg-white text-sm">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <Link href={`/students/${item.id}`} className="underline">
              {item.fullName}
            </Link>
            <span className="ml-2 text-muted">
              {item.schoolName} · sabah {item.morningPlanStatus} · akşam {item.eveningPlanStatus}
              {item.addressVerification === 'PENDING' ? ' · adres pin bekliyor' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
