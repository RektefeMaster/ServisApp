'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

interface TripDetail {
  id: string;
  plate: string;
  schoolName: string;
  state: string;
  segment: string;
  students: Array<{
    id: string;
    studentId: string;
    fullName: string;
    state: string;
    deliveryTarget?: string;
    deliveryVerified?: boolean;
  }>;
}

interface OverrideRow {
  id: string;
  studentId: string;
  status: string;
}

export default function TripDetailPage() {
  const params = useParams<{ tripId: string }>();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const next = await apiFetch<TripDetail>(`/v1/admin/trips/${params.tripId}`);
    setTrip(next);
    const listed = await apiFetch<{ overrides: OverrideRow[] }>('/v1/admin/exceptions');
    setOverrides(listed.overrides);
  }

  useEffect(() => {
    void reload().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : 'Okunamadı'),
    );
  }, [params.tripId]);

  async function cancel() {
    try {
      await apiFetch(`/v1/trips/${params.tripId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Yönetici iptali' }),
      });
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'İptal başarısız');
    }
  }

  async function adminVerify(student: TripDetail['students'][number]) {
    const override = overrides.find(
      (row) =>
        row.studentId === student.studentId &&
        (row.status === 'ACTIVE' || row.status === 'LOCKED' || row.status === 'EXPIRED'),
    );
    if (!override) {
      setError('Bu öğrenci için yönetici onayı verilecek teslim talebi yok');
      return;
    }
    try {
      await apiFetch(`/v1/admin/delivery-overrides/${override.id}/admin-verify`, {
        method: 'POST',
        body: JSON.stringify({ tripStudentId: student.id, reason: 'Yönetici teslim onayı' }),
      });
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Yönetici onayı başarısız');
    }
  }

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!trip) return <p className="text-sm text-muted">Yükleniyor…</p>;

  return (
    <div>
      <h1 className="font-serif text-2xl">
        {trip.plate} · {trip.schoolName}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {trip.segment === 'MORNING' ? 'Sabah' : 'Akşam'} · {trip.state}
      </p>
      <section className="mt-8 border border-dashed border-rule bg-white px-4 py-6">
        <h2 className="text-sm font-medium">Canlı</h2>
        <p className="mt-2 text-sm text-muted">
          GPS henüz bu panel dalgasında yok. Konum geldiğinde sefer detayının altında burada duracak;
          yan menüde ayrı madde olmayacak.
        </p>
      </section>
      <ul className="mt-6 divide-y divide-rule border border-rule bg-white text-sm">
        {trip.students.map((student) => (
          <li key={student.id} className="flex items-center justify-between gap-3 px-4 py-2">
            <span>
              {student.fullName}
              {student.deliveryTarget === 'TEMP' ? ' · farklı adres' : ''}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-muted">{student.state}</span>
              {student.deliveryTarget === 'TEMP' && !student.deliveryVerified ? (
                <button type="button" className="underline" onClick={() => void adminVerify(student)}>
                  Yönetici teslim onayı
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {trip.state === 'PLANNED' || trip.state === 'READY' ? (
        <button type="button" className="mt-4 text-sm underline" onClick={() => void cancel()}>
          Seferi iptal et
        </button>
      ) : null}
    </div>
  );
}
