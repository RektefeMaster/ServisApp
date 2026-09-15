'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CheckField, FormGrid, Notice, SelectField, TextField } from '@/components/form';
import { apiFetch } from '@/lib/session';

interface School {
  id: string;
  name: string;
  level: string;
}

interface AddressRow {
  id: string;
  text: string;
}

type SchoolLevel = 'PRESCHOOL' | 'PRIMARY' | 'SECONDARY' | 'HIGH';

const LEVELS: ReadonlyArray<{ value: SchoolLevel; label: string }> = [
  { value: 'PRESCHOOL', label: 'Anaokulu' },
  { value: 'PRIMARY', label: 'İlkokul' },
  { value: 'SECONDARY', label: 'Ortaokul' },
  { value: 'HIGH', label: 'Lise' },
];

const LEVEL_LABEL: Record<string, string> = {
  PRESCHOOL: 'Anaokulu',
  PRIMARY: 'İlkokul',
  SECONDARY: 'Ortaokul',
  HIGH: 'Lise',
};

export default function SchoolsPage() {
  const [items, setItems] = useState<School[]>([]);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [level, setLevel] = useState<SchoolLevel>('PRIMARY');
  const [addressId, setAddressId] = useState('');
  const [attendantRequired, setAttendantRequired] = useState(true);

  const [holidaySchoolId, setHolidaySchoolId] = useState('');
  const [holidayDate, setHolidayDate] = useState('');

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
        apiFetch<{ items: School[] }>('/v1/admin/schools'),
        apiFetch<{ items: AddressRow[] }>('/v1/admin/addresses'),
      ])
        .then(([schools, addressList]) => {
          if (!alive.current) return;
          setItems(schools.items);
          setAddresses(addressList.items);
          setAddressId((current) => current || (addressList.items[0]?.id ?? ''));
          setHolidaySchoolId((current) => current || (schools.items[0]?.id ?? ''));
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

  async function createSchool() {
    if (!addressId) {
      setError('Önce "Adres ve durak" ekranından okulun adresini pinleyin.');
      return;
    }
    if (name.trim().length < 2) {
      setError('Okul adı en az 2 karakter olmalı.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/v1/admin/schools', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), level, addressId, attendantRequired }),
      });
      setName('');
      setOk('Okul eklendi');
      setError(null);
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Okul eklenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function addHoliday() {
    if (!holidaySchoolId || !holidayDate) {
      setError('Okul ve tarih seçin.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/v1/admin/schools/${holidaySchoolId}/calendar-days`, {
        method: 'POST',
        body: JSON.stringify({ date: holidayDate, type: 'HOLIDAY' }),
      });
      setHolidayDate('');
      setError(null);
      setOk('Tatil işlendi. O güne üretilmiş seferler iptal edildi.');
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Tatil işlenemedi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">Okullar</h1>
      <p className="mt-1 text-sm text-muted">
        Hostes zorunluluğu okul bazındadır ve seferin hazır olmasını etkiler.
      </p>
      <Notice error={error} ok={ok} />

      <Card title="Okul ekle">
        <FormGrid onSubmit={createSchool} busy={busy} submitLabel="Okulu kaydet">
          <TextField label="Okul adı" value={name} onChange={setName} />
          <SelectField label="Kademe" value={level} onChange={setLevel} options={LEVELS} />
          <label className="block text-sm">
            <span className="text-muted">Okul adresi</span>
            <select
              className="mt-1 w-full rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={addressId}
              onChange={(event) => setAddressId(event.target.value)}
            >
              <option value="">Seçin…</option>
              {addresses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.text}
                </option>
              ))}
            </select>
          </label>
          <CheckField
            label="Hostes zorunlu"
            checked={attendantRequired}
            onChange={setAttendantRequired}
            hint="Küçük yaş gruplarında zorunludur; hostes atanmadan sefer hazır olamaz."
          />
        </FormGrid>
        <ul className="mt-4 divide-y divide-rule border border-rule text-sm">
          {items.map((item) => (
            <li key={item.id} className="px-3 py-2">
              {item.name}
              <span className="ml-2 text-muted">{LEVEL_LABEL[item.level] ?? item.level}</span>
            </li>
          ))}
          {items.length === 0 ? <li className="px-3 py-2 text-muted">Henüz okul yok.</li> : null}
        </ul>
      </Card>

      <Card title="Tatil günü">
        <p className="mb-3 text-sm text-muted">
          Resmî tatil, ara tatil ve kar tatili buradan işlenir. Tatil işlendiği anda o gün için
          üretilmiş, henüz başlamamış seferler iptal edilir — şoför boş okula gitmez.
        </p>
        <FormGrid onSubmit={addHoliday} busy={busy} submitLabel="Tatil olarak işaretle">
          <label className="block text-sm">
            <span className="text-muted">Okul</span>
            <select
              className="mt-1 w-full rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={holidaySchoolId}
              onChange={(event) => setHolidaySchoolId(event.target.value)}
            >
              <option value="">Seçin…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Tarih" value={holidayDate} onChange={setHolidayDate} type="date" />
        </FormGrid>
      </Card>
    </div>
  );
}
