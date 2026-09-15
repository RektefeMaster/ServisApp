'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Card,
  FormGrid,
  Notice,
  SelectField,
  TextField,
  confirmDestructive,
} from '@/components/form';
import { apiFetch } from '@/lib/session';
import { membershipStatusLabel } from '@/lib/labels';

interface Vehicle {
  id: string;
  plate: string;
  seatCount: number;
}

interface Staff {
  membershipId: string;
  fullName: string;
  phone: string;
  roles: string[];
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED';
}

interface DeviceRow {
  deviceId: string;
  platform: string;
  revokedAt: string | null;
  lastSyncAt: string | null;
}

type StaffRole = 'ADMIN' | 'DRIVER' | 'ATTENDANT';
type StaffStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

const ROLES: ReadonlyArray<{ value: StaffRole; label: string }> = [
  { value: 'DRIVER', label: 'Şoför' },
  { value: 'ATTENDANT', label: 'Hostes' },
  { value: 'ADMIN', label: 'Yönetici' },
];

export default function FleetPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [devices, setDevices] = useState<Record<string, DeviceRow[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [plate, setPlate] = useState('');
  const [seatCount, setSeatCount] = useState('');
  const [modelYear, setModelYear] = useState('');
  const [inspectionExpiry, setInspectionExpiry] = useState('');
  const [insuranceExpiry, setInsuranceExpiry] = useState('');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+90');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('DRIVER');
  const [staffVehicleId, setStaffVehicleId] = useState('');

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
        apiFetch<{ items: Vehicle[] }>('/v1/admin/vehicles'),
        apiFetch<{ items: Staff[] }>('/v1/admin/staff'),
      ])
        .then(([v, s]) => {
          if (!alive.current) return;
          setVehicles(v.items);
          setStaff(s.items);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (!alive.current) return;
          setError(caught instanceof Error ? caught.message : 'Filo okunamadı');
        }),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  async function addVehicle() {
    const seats = Number(seatCount);
    if (!Number.isInteger(seats) || seats < 1) {
      setError('Koltuk sayısı tam sayı olmalı');
      return;
    }
    const year = modelYear.trim() ? Number(modelYear.trim()) : undefined;
    if (year !== undefined && (!Number.isInteger(year) || year < 1990 || year > 2100)) {
      setError('Model yılı 1990-2100 arasında olmalı');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/v1/admin/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          plate: plate.trim(),
          seatCount: seats,
          ...(year === undefined ? {} : { modelYear: year }),
          ...(inspectionExpiry ? { inspectionExpiry } : {}),
          ...(insuranceExpiry ? { insuranceExpiry } : {}),
        }),
      });
      setPlate('');
      setSeatCount('');
      setModelYear('');
      setInspectionExpiry('');
      setInsuranceExpiry('');
      setError(null);
      setOk('Araç eklendi');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Araç eklenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function addStaff() {
    if (fullName.trim().length < 2) {
      setError('Ad soyad en az 2 karakter olmalı');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/v1/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          role,
          ...(staffVehicleId && role !== 'ADMIN' ? { vehicleId: staffVehicleId } : {}),
        }),
      });
      setFullName('');
      setPhone('+90');
      setEmail('');
      setError(null);
      setOk('Personel eklendi. İlk girişinde üyeliği aktifleşir.');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Personel eklenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(membershipId: string, next: StaffStatus, name: string) {
    if (next !== 'ACTIVE') {
      const message =
        next === 'REVOKED'
          ? `${name} kalıcı olarak iptal edilecek ve tüm cihazları kapatılacak. Onaylıyor musunuz?`
          : `${name} askıya alınacak ve cihazları kapatılacak. Onaylıyor musunuz?`;
      if (!confirmDestructive(message)) return;
    }
    setBusy(true);
    try {
      await apiFetch(`/v1/admin/staff/${membershipId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: next }),
      });
      setError(null);
      setOk(`${name} durumu güncellendi`);
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Durum değiştirilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function loadDevices(membershipId: string) {
    try {
      const body = await apiFetch<{ items: DeviceRow[] }>(
        `/v1/admin/staff/${membershipId}/devices`,
      );
      setDevices((current) => ({ ...current, [membershipId]: body.items }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cihazlar okunamadı');
    }
  }

  async function revokeDevice(membershipId: string, deviceId: string) {
    if (!confirmDestructive('Bu cihazın erişimi kalıcı olarak kapatılacak. Onaylıyor musunuz?')) {
      return;
    }
    try {
      await apiFetch(`/v1/admin/devices/${deviceId}/revoke`, { method: 'POST' });
      setOk('Cihaz iptal edildi');
      setError(null);
      await loadDevices(membershipId);
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Cihaz iptal edilemedi');
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">Filo</h1>
      <p className="mt-1 text-sm text-muted">
        Muayene veya sigortası geçmiş araçla sefer başlatılamaz; tarihleri girin ki panel önceden
        uyarsın.
      </p>
      <Notice error={error} ok={ok} />

      <Card title="Araç ekle">
        <FormGrid onSubmit={addVehicle} busy={busy} submitLabel="Aracı kaydet">
          <TextField label="Plaka" value={plate} onChange={setPlate} placeholder="34 ABC 123" />
          <TextField
            label="Koltuk sayısı"
            value={seatCount}
            onChange={setSeatCount}
            inputMode="numeric"
          />
          <TextField
            label="Model yılı"
            value={modelYear}
            onChange={setModelYear}
            inputMode="numeric"
          />
          <div />
          <TextField
            label="Muayene bitiş"
            value={inspectionExpiry}
            onChange={setInspectionExpiry}
            type="date"
          />
          <TextField
            label="Sigorta bitiş"
            value={insuranceExpiry}
            onChange={setInsuranceExpiry}
            type="date"
          />
        </FormGrid>
        <ul className="mt-4 divide-y divide-rule border border-rule text-sm">
          {vehicles.map((item) => (
            <li key={item.id} className="px-3 py-2">
              {item.plate} · {item.seatCount} koltuk
            </li>
          ))}
          {vehicles.length === 0 ? <li className="px-3 py-2 text-muted">Henüz araç yok.</li> : null}
        </ul>
      </Card>

      <Card title="Personel ekle">
        <FormGrid onSubmit={addStaff} busy={busy} submitLabel="Personeli kaydet">
          <TextField label="Ad soyad" value={fullName} onChange={setFullName} />
          <TextField label="Telefon" value={phone} onChange={setPhone} type="tel" />
          <TextField label="E-posta" value={email} onChange={setEmail} type="email" />
          <SelectField label="Görev" value={role} onChange={setRole} options={ROLES} />
          {role === 'ADMIN' ? null : (
            <label className="block text-sm">
              <span className="text-muted">Sabit araç (isteğe bağlı)</span>
              <select
                className="mt-1 w-full rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                value={staffVehicleId}
                onChange={(event) => setStaffVehicleId(event.target.value)}
              >
                <option value="">Atama yok</option>
                {vehicles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.plate}
                  </option>
                ))}
              </select>
            </label>
          )}
        </FormGrid>
      </Card>

      <Card title="Personel">
        <ul className="divide-y divide-rule border border-rule text-sm">
          {staff.map((item) => (
            <li key={item.membershipId} className="px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.fullName}</span>
                <span className="text-muted">
                  {item.roles.join(', ')} · {membershipStatusLabel(item.status)}
                </span>
                <span className="ml-auto flex gap-2">
                  {item.status === 'ACTIVE' || item.status === 'INVITED' ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="underline disabled:opacity-50"
                      onClick={() => void setStatus(item.membershipId, 'SUSPENDED', item.fullName)}
                    >
                      Askıya al
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      className="underline disabled:opacity-50"
                      onClick={() => void setStatus(item.membershipId, 'ACTIVE', item.fullName)}
                    >
                      Yeniden aktifleştir
                    </button>
                  )}
                  {item.status === 'REVOKED' ? null : (
                    <button
                      type="button"
                      disabled={busy}
                      className="text-red-700 underline disabled:opacity-50"
                      onClick={() => void setStatus(item.membershipId, 'REVOKED', item.fullName)}
                    >
                      İptal et
                    </button>
                  )}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void loadDevices(item.membershipId)}
                  >
                    Cihazlar
                  </button>
                </span>
              </div>
              {devices[item.membershipId] ? (
                <ul className="mt-2 border-l-2 border-rule pl-3 text-xs">
                  {devices[item.membershipId]?.map((row) => (
                    <li key={row.deviceId} className="py-1">
                      {row.platform} · {row.revokedAt ? 'iptal' : 'açık'}
                      {row.revokedAt ? null : (
                        <button
                          type="button"
                          className="ml-2 text-red-700 underline"
                          onClick={() => void revokeDevice(item.membershipId, row.deviceId)}
                        >
                          İptal et
                        </button>
                      )}
                    </li>
                  ))}
                  {devices[item.membershipId]?.length === 0 ? (
                    <li className="py-1 text-muted">Kayıtlı cihaz yok.</li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          ))}
          {staff.length === 0 ? (
            <li className="px-3 py-2 text-muted">Henüz personel yok.</li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}
