'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CheckField, FormGrid, Notice, SelectField, TextField } from '@/components/form';
import { apiFetch } from '@/lib/session';
import { planStatusLabel } from '@/lib/labels';

interface StudentRow {
  id: string;
  fullName: string;
  schoolName: string;
  grade: string | null;
  morningPlanStatus: string;
  eveningPlanStatus: string;
  addressVerification: string;
}

interface SchoolRow {
  id: string;
  name: string;
}

interface AddressRow {
  id: string;
  text: string;
}

type HandoverPolicy = 'GUARDIAN_REQUIRED' | 'MAY_LEAVE_ALONE';

const POLICIES: ReadonlyArray<{ value: HandoverPolicy; label: string }> = [
  { value: 'GUARDIAN_REQUIRED', label: 'Kapıda yetkili biri olmalı' },
  { value: 'MAY_LEAVE_ALONE', label: 'Tek başına inebilir' },
];

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

export default function StudentsPage() {
  const [items, setItems] = useState<StudentRow[]>([]);
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const [fullName, setFullName] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [grade, setGrade] = useState('');
  const [handoverPolicy, setHandoverPolicy] = useState<HandoverPolicy>('GUARDIAN_REQUIRED');
  const [enrollmentStart, setEnrollmentStart] = useState(todayYmd());
  const [usesMorning, setUsesMorning] = useState(true);
  const [usesEvening, setUsesEvening] = useState(true);
  const [pickupAddressId, setPickupAddressId] = useState('');
  const [dropoffAddressId, setDropoffAddressId] = useState('');

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(
    (): Promise<void> =>
      Promise.all([
        apiFetch<{ items: StudentRow[] }>('/v1/admin/students'),
        apiFetch<{ items: SchoolRow[] }>('/v1/admin/schools'),
        apiFetch<{ items: AddressRow[] }>('/v1/admin/addresses'),
      ])
        .then(([studentList, schoolList, addressList]) => {
          if (!alive.current) return;
          setItems(studentList.items);
          setSchools(schoolList.items);
          setAddresses(addressList.items);
          setSchoolId((current) => current || (schoolList.items[0]?.id ?? ''));
          setError(null);
        })
        .catch((caught: unknown) => {
          if (!alive.current) return;
          setError(caught instanceof Error ? caught.message : 'Okunamadı');
        }),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    if (needle.length === 0) return items;
    return items.filter(
      (item) =>
        item.fullName.toLocaleLowerCase('tr').includes(needle) ||
        item.schoolName.toLocaleLowerCase('tr').includes(needle),
    );
  }, [items, query]);

  async function createStudent() {
    if (fullName.trim().length < 2) {
      setError('Ad soyad en az 2 karakter olmalı.');
      return;
    }
    if (!schoolId) {
      setError('Önce okul tanımlayın.');
      return;
    }
    if (!usesMorning && !usesEvening) {
      setError('En az bir sefer seçilmeli.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/v1/admin/students', {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          schoolId,
          handoverPolicy,
          enrollmentStart,
          usesMorning,
          usesEvening,
          ...(grade.trim() ? { grade: grade.trim() } : {}),
          ...(pickupAddressId ? { pickupAddressId } : {}),
          ...(dropoffAddressId ? { dropoffAddressId } : {}),
        }),
      });
      setFullName('');
      setGrade('');
      setError(null);
      setOk('Öğrenci eklendi. Velisini öğrenci sayfasından ekleyin.');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Öğrenci eklenemedi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl">Öğrenciler</h1>
          <p className="mt-1 text-sm text-muted">
            Davet kişi sayısına göre gider; çocuk sayısı SMS üretmez.
          </p>
        </div>
        <Link href="/students/import" className="text-sm underline">
          İçe aktar
        </Link>
      </div>
      <Notice error={error} ok={ok} />

      <Card title="Öğrenci ekle">
        <FormGrid onSubmit={createStudent} busy={busy} submitLabel="Öğrenciyi kaydet">
          <TextField label="Ad soyad" value={fullName} onChange={setFullName} />
          <label className="block text-sm">
            <span className="text-muted">Okul</span>
            <select
              className="mt-1 w-full rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={schoolId}
              onChange={(event) => setSchoolId(event.target.value)}
            >
              <option value="">Seçin…</option>
              {schools.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Sınıf" value={grade} onChange={setGrade} placeholder="3-A" />
          <SelectField
            label="Teslim politikası"
            value={handoverPolicy}
            onChange={setHandoverPolicy}
            options={POLICIES}
            hint="Kapıda çocuğu kimin alabileceğini belirler."
          />
          <TextField
            label="Kayıt başlangıcı"
            value={enrollmentStart}
            onChange={setEnrollmentStart}
            type="date"
          />
          <div className="flex flex-col gap-2 pt-6">
            <CheckField label="Sabah servisi" checked={usesMorning} onChange={setUsesMorning} />
            <CheckField label="Akşam servisi" checked={usesEvening} onChange={setUsesEvening} />
          </div>
          <label className="block text-sm">
            <span className="text-muted">Binme adresi</span>
            <select
              className="mt-1 w-full rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={pickupAddressId}
              onChange={(event) => setPickupAddressId(event.target.value)}
            >
              <option value="">Sonra pinlenecek</option>
              {addresses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.text}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">İnme adresi</span>
            <select
              className="mt-1 w-full rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={dropoffAddressId}
              onChange={(event) => setDropoffAddressId(event.target.value)}
            >
              <option value="">Sonra pinlenecek</option>
              {addresses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.text}
                </option>
              ))}
            </select>
          </label>
        </FormGrid>
      </Card>

      <div className="mt-6">
        <TextField label="Ara" value={query} onChange={setQuery} placeholder="Ad veya okul" />
      </div>
      <ul className="mt-3 divide-y divide-rule border border-rule bg-white text-sm">
        {visible.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <Link href={`/students/${item.id}`} className="underline">
              {item.fullName}
            </Link>
            <span className="ml-2 text-muted">
              {item.schoolName}
              {item.grade ? ` · ${item.grade}` : ''} · sabah{' '}
              {planStatusLabel(item.morningPlanStatus)} · akşam{' '}
              {planStatusLabel(item.eveningPlanStatus)}
              {item.addressVerification === 'PENDING' ? ' · adres pin bekliyor' : ''}
            </span>
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="px-4 py-3 text-muted">
            {items.length === 0 ? 'Henüz öğrenci yok.' : 'Aramaya uyan öğrenci yok.'}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
