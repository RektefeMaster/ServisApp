'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/session';

interface Vehicle {
  id: string;
  plate: string;
  seatCount: number;
}

interface Staff {
  membershipId: string;
  fullName: string;
  roles: string[];
}

export default function FleetPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [plate, setPlate] = useState('');
  const [seatCount, setSeatCount] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void reload();
  }, []);

  async function reload() {
    try {
      const [v, s] = await Promise.all([
        apiFetch<{ items: Vehicle[] }>('/v1/admin/vehicles'),
        apiFetch<{ items: Staff[] }>('/v1/admin/staff'),
      ]);
      setVehicles(v.items);
      setStaff(s.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Filo okunamadı');
    }
  }

  async function addVehicle(event: FormEvent) {
    event.preventDefault();
    const seats = Number(seatCount);
    if (!Number.isInteger(seats) || seats < 1) {
      setError('Koltuk sayısı tam sayı olmalı');
      return;
    }
    try {
      await apiFetch('/v1/admin/vehicles', {
        method: 'POST',
        body: JSON.stringify({ plate, seatCount: seats }),
      });
      setPlate('');
      setSeatCount('');
      setError(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Araç eklenemedi');
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">Filo</h1>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <form onSubmit={(event) => void addVehicle(event)} className="mt-4 flex gap-2">
        <input
          className="rounded border border-rule bg-white px-2 py-1 text-sm"
          placeholder="Plaka"
          value={plate}
          onChange={(event) => setPlate(event.target.value)}
        />
        <input
          className="w-28 rounded border border-rule bg-white px-2 py-1 text-sm"
          placeholder="Koltuk"
          inputMode="numeric"
          value={seatCount}
          onChange={(event) => setSeatCount(event.target.value)}
        />
        <button className="rounded bg-ink px-3 py-1 text-sm text-paper" type="submit">
          Araç ekle
        </button>
      </form>
      <ul className="mt-6 divide-y divide-rule border border-rule bg-white text-sm">
        {vehicles.map((item) => (
          <li key={item.id} className="px-4 py-2">
            {item.plate} · {item.seatCount} koltuk
          </li>
        ))}
      </ul>
      <h2 className="mt-8 text-sm font-medium">Personel</h2>
      <ul className="mt-2 divide-y divide-rule border border-rule bg-white text-sm">
        {staff.map((item) => (
          <li key={item.membershipId} className="px-4 py-2">
            {item.fullName} · {item.roles.join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
