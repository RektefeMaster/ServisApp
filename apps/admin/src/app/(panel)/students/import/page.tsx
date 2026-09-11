'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

interface ImportBatch {
  id: string;
  summary: {
    total: number;
    ready: number;
    needsFix: number;
    addressUnverified: number;
    uniqueGuardianPhones: number;
    committed: number;
  };
  rows: Array<{ rowNo: number; status: string; errorCode: string | null; studentFullName: string | null }>;
}

interface School {
  id: string;
  name: string;
}

export default function ImportPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [text, setText] = useState(
    'öğrenci;veli;telefon\nEfe Demir;Ayşe Demir;+905321110004\nAda Demir;Ayşe Demir;+905321110004',
  );
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ items: School[] }>('/v1/admin/schools')
      .then((body) => {
        setSchools(body.items);
        setSchoolId(body.items[0]?.id ?? '');
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Okullar okunamadı'));
  }, []);

  function rowsFromText() {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line, index) => line.length > 0 && index > 0);
    return lines.map((line, index) => {
      const [studentFullName, guardianFullName, guardianPhone] = line.split(';').map((part) => part.trim());
      return {
        rowNo: index + 1,
        studentFullName,
        schoolId,
        enrollmentStart: new Date().toISOString().slice(0, 10),
        guardianFullName,
        guardianPhone,
        relation: 'Veli',
      };
    });
  }

  async function preview() {
    setError(null);
    try {
      const body = await apiFetch<ImportBatch>('/v1/admin/imports/preview', {
        method: 'POST',
        body: JSON.stringify({ fileName: 'panel.csv', rows: rowsFromText() }),
      });
      setBatch(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Önizleme başarısız');
    }
  }

  async function commit() {
    if (!batch) return;
    setError(null);
    try {
      const body = await apiFetch<ImportBatch>(`/v1/admin/imports/${batch.id}/commit`, {
        method: 'POST',
        body: JSON.stringify({ onlyReady: true }),
      });
      setBatch(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Kayıt başarısız');
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">İçe aktarma</h1>
      <p className="mt-1 text-sm text-muted">31 öğrenci = 31 SMS değildir. Benzersiz telefon kadar davet gider.</p>
      <textarea
        className="mt-4 h-40 w-full rounded border border-rule bg-white p-3 font-mono text-sm"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="mt-3 flex gap-2">
        <select
          className="rounded border border-rule bg-white px-2 py-1 text-sm"
          value={schoolId}
          onChange={(event) => setSchoolId(event.target.value)}
        >
          {schools.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button type="button" className="rounded bg-ink px-3 py-1 text-sm text-paper" onClick={() => void preview()}>
          Önizle
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {batch ? (
        <section className="mt-8 border border-rule bg-white p-5">
          <p className="font-medium">{batch.summary.total} satır</p>
          <p className="mt-2 text-sm">
            {batch.summary.ready} hazır
            <br />
            {batch.summary.needsFix} düzeltilmeli
            <br />
            {batch.summary.addressUnverified} adres doğrulanmalı
          </p>
          <p className="mt-4 text-sm text-muted">
            Sonraki adım: {batch.summary.uniqueGuardianPhones} benzersiz telefon → {batch.summary.uniqueGuardianPhones}{' '}
            davet
          </p>
          <button
            type="button"
            className="mt-4 rounded bg-ink px-3 py-2 text-sm text-paper"
            onClick={() => void commit()}
          >
            Sadece hazır kayıtları oluştur
          </button>
          <ul className="mt-4 text-sm">
            {batch.rows.map((row) => (
              <li key={row.rowNo}>
                {row.rowNo}. {row.studentFullName ?? '—'} · {row.status}
                {row.errorCode ? ` (${row.errorCode})` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
