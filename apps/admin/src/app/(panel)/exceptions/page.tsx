'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

interface ExceptionRow {
  id: string;
  studentName: string;
  serviceDate: string;
  segment: string;
  cancelledAt: string | null;
}

interface OverrideRow {
  id: string;
  studentId: string;
  studentName: string;
  serviceDate: string;
  status: string;
  receiverName: string;
  addressText: string;
  detourM: number;
  maxDetourM: number;
}

interface AddressChangeRow {
  id: string;
  studentName: string;
  status: string;
  addressText: string;
  effectiveFromDate: string;
}

interface ExceptionsBody {
  available: true;
  exceptions: ExceptionRow[];
  overrides: OverrideRow[];
  addressChanges: AddressChangeRow[];
}

export default function ExceptionsPage() {
  const [body, setBody] = useState<ExceptionsBody | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void apiFetch<ExceptionsBody>('/v1/admin/exceptions')
      .then((next) => {
        setBody(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        setBody(null);
        setError(caught instanceof Error ? caught.message : 'İstisnalar okunamadı');
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function post(path: string) {
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify({}) });
      reload();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'İşlem başarısız');
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">İstisnalar</h1>
      <p className="mt-1 max-w-xl text-sm text-muted">
        Bugün binmeyecek, farklı teslimat ve adres talepleri. Teslim kodu bu ekranda yok.
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {!body ? <p className="mt-4 text-sm text-muted">Yükleniyor…</p> : null}
      {body ? (
        <>
          <h2 className="mt-8 text-sm font-medium">Bugün kullanmayacak</h2>
          <ul className="mt-2 divide-y divide-rule border border-rule bg-white text-sm">
            {body.exceptions.length === 0 ? (
              <li className="px-4 py-3 text-muted">Kayıt yok</li>
            ) : (
              body.exceptions.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  {row.studentName} · {row.serviceDate} · {row.segment === 'MORNING' ? 'sabah' : 'akşam'}
                  {row.cancelledAt ? ' · iptal' : ''}
                </li>
              ))
            )}
          </ul>
          <h2 className="mt-8 text-sm font-medium">Farklı teslimat</h2>
          <ul className="mt-2 divide-y divide-rule border border-rule bg-white text-sm">
            {body.overrides.length === 0 ? (
              <li className="px-4 py-3 text-muted">Kayıt yok</li>
            ) : (
              body.overrides.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span>
                    {row.studentName} · {row.serviceDate} · {row.status} · {row.receiverName} · {row.addressText}
                    {row.detourM > row.maxDetourM ? ` · +${row.detourM} m (eşik ${row.maxDetourM} m)` : ''}
                  </span>
                  {row.status === 'PENDING_APPROVAL' ? (
                    <span className="flex gap-3">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void post(`/v1/admin/delivery-overrides/${row.id}/approve`)}
                      >
                        Onayla
                      </button>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void post(`/v1/admin/delivery-overrides/${row.id}/reject`)}
                      >
                        Reddet
                      </button>
                    </span>
                  ) : null}
                  {row.status === 'LOCKED' ? (
                    <span className="text-muted">Kod kilitli — sefer detayından yönetici teslim onayı</span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
          <h2 className="mt-8 text-sm font-medium">Adres değişikliği</h2>
          <ul className="mt-2 divide-y divide-rule border border-rule bg-white text-sm">
            {body.addressChanges.length === 0 ? (
              <li className="px-4 py-3 text-muted">Kayıt yok</li>
            ) : (
              body.addressChanges.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span>
                    {row.studentName} · {row.status} · {row.effectiveFromDate} · {row.addressText}
                  </span>
                  {row.status === 'PENDING' ? (
                    <span className="flex gap-3">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void post(`/v1/admin/address-changes/${row.id}/approve`)}
                      >
                        Onayla
                      </button>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => void post(`/v1/admin/address-changes/${row.id}/reject`)}
                      >
                        Reddet
                      </button>
                    </span>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </>
      ) : null}
    </div>
  );
}
