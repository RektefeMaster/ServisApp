'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, FormGrid, Notice, SelectField, TextField } from '@/components/form';
import { apiFetch } from '@/lib/session';

interface RouteRow {
  id: string;
  segment: string;
  schoolId: string;
  shiftNo: number;
  departureLocalTime: string;
  retiredAt: string | null;
  publishedVersionId: string | null;
  draftVersionId: string | null;
}

interface NamedRow {
  id: string;
  name?: string;
  plate?: string;
}

type Segment = 'MORNING' | 'AFTERNOON';

const SEGMENTS: ReadonlyArray<{ value: Segment; label: string }> = [
  { value: 'MORNING', label: 'Sabah (eve → okul)' },
  { value: 'AFTERNOON', label: 'Akşam (okul → ev)' },
];

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

export default function RoutesPage() {
  const router = useRouter();
  const [items, setItems] = useState<RouteRow[]>([]);
  const [schools, setSchools] = useState<NamedRow[]>([]);
  const [vehicles, setVehicles] = useState<NamedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [vehicleId, setVehicleId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [segment, setSegment] = useState<Segment>('MORNING');
  const [shiftNo, setShiftNo] = useState('1');
  const [departureLocalTime, setDepartureLocalTime] = useState('07:00');
  const [effectiveFrom, setEffectiveFrom] = useState(todayYmd());

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
        apiFetch<{ items: RouteRow[] }>('/v1/admin/routes'),
        apiFetch<{ items: NamedRow[] }>('/v1/admin/schools'),
        apiFetch<{ items: NamedRow[] }>('/v1/admin/vehicles'),
      ])
        .then(([routes, schoolList, vehicleList]) => {
          if (!alive.current) return;
          setItems(routes.items);
          setSchools(schoolList.items);
          setVehicles(vehicleList.items);
          setSchoolId((current) => current || (schoolList.items[0]?.id ?? ''));
          setVehicleId((current) => current || (vehicleList.items[0]?.id ?? ''));
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

  const schoolName = useCallback(
    (id: string) => schools.find((item) => item.id === id)?.name ?? 'okul',
    [schools],
  );

  async function createRoute() {
    if (!vehicleId || !schoolId) {
      setError('Önce araç ve okul tanımlayın.');
      return;
    }
    const shift = Number(shiftNo);
    if (!Number.isInteger(shift) || shift < 1 || shift > 10) {
      setError('Vardiya 1-10 arasında olmalı.');
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch<{ id: string; draftVersionId: string }>('/v1/admin/routes', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId,
          schoolId,
          segment,
          shiftNo: shift,
          departureLocalTime,
          effectiveFrom,
        }),
      });
      setError(null);
      setOk('Rota oluşturuldu. Şimdi duraklarını ekleyip yayınlayın.');
      await reload();
      router.push(`/routes/${created.id}`);
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Rota oluşturulamadı');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">Rotalar</h1>
      <p className="mt-1 text-sm text-muted">
        Öğrenci araca değil rotaya bağlıdır. Her rota kendi kalkış saatini taşır.
      </p>
      <Notice error={error} ok={ok} />

      <Card title="Rota oluştur">
        <FormGrid onSubmit={createRoute} busy={busy} submitLabel="Rotayı oluştur">
          <label className="block text-sm">
            <span className="text-muted">Araç</span>
            <select
              className="mt-1 w-full rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
            >
              <option value="">Seçin…</option>
              {vehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.plate}
                </option>
              ))}
            </select>
          </label>
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
          <SelectField label="Sefer" value={segment} onChange={setSegment} options={SEGMENTS} />
          <TextField
            label="Vardiya"
            value={shiftNo}
            onChange={setShiftNo}
            inputMode="numeric"
            hint="Aynı araç aynı okula birden çok sefer yapıyorsa 2, 3…"
          />
          <TextField
            label="Kalkış saati"
            value={departureLocalTime}
            onChange={setDepartureLocalTime}
            type="time"
            hint="Trafik tahmini ve otomatik kapanış bu saate göre çalışır."
          />
          <TextField
            label="Geçerlilik başlangıcı"
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            type="date"
          />
        </FormGrid>
      </Card>

      <ul className="mt-6 divide-y divide-rule border border-rule bg-white text-sm">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            <Link href={`/routes/${item.id}`} className="underline">
              {schoolName(item.schoolId)} · {item.segment === 'MORNING' ? 'Sabah' : 'Akşam'}
            </Link>
            <span className="ml-2 tabular-nums">{item.departureLocalTime}</span>
            <span className="ml-2 text-muted">
              {item.shiftNo}. vardiya · {item.publishedVersionId ? 'yayınlı' : 'taslak'}
              {item.retiredAt ? ' · emekli' : ''}
            </span>
          </li>
        ))}
        {items.length === 0 ? <li className="px-4 py-3 text-muted">Henüz rota yok.</li> : null}
      </ul>
    </div>
  );
}
