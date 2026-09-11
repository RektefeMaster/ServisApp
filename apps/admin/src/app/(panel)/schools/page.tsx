'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/session';

interface School {
  id: string;
  name: string;
  level: string;
}

export default function SchoolsPage() {
  const [items, setItems] = useState<School[]>([]);
  const [name, setName] = useState('');
  const [addresses, setAddresses] = useState<Array<{ id: string; text: string }>>([]);
  const [addressId, setAddressId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ items: School[] }>('/v1/admin/schools')
      .then((body) => setItems(body.items))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Okunamadı'));
    void apiFetch<{ items: Array<{ id: string; text: string }> }>('/v1/admin/addresses')
      .then((body) => {
        setAddresses(body.items);
        setAddressId(body.items[0]?.id ?? '');
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Okunamadı'));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!addressId) {
      setError('Önce adres pinleyin');
      return;
    }
    try {
      await apiFetch('/v1/admin/schools', {
        method: 'POST',
        body: JSON.stringify({ name, level: 'PRIMARY', addressId, attendantRequired: true }),
      });
      const listed = await apiFetch<{ items: School[] }>('/v1/admin/schools');
      setItems(listed.items);
      setName('');
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Okul eklenemedi');
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">Okullar</h1>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <form onSubmit={(event) => void create(event)} className="mt-4 flex gap-2">
        <input
          className="rounded border border-rule bg-white px-2 py-1 text-sm"
          placeholder="Okul adı"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          className="rounded border border-rule bg-white px-2 py-1 text-sm"
          value={addressId}
          onChange={(event) => setAddressId(event.target.value)}
        >
          {addresses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.text}
            </option>
          ))}
        </select>
        <button className="rounded bg-ink px-3 py-1 text-sm text-paper" type="submit">
          Ekle
        </button>
      </form>
      <ul className="mt-6 divide-y divide-rule border border-rule bg-white text-sm">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-2">
            {item.name} · {item.level}
          </li>
        ))}
      </ul>
    </div>
  );
}
