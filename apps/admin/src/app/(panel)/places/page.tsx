'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, FormGrid, Notice, TextField } from '@/components/form';
import { apiFetch } from '@/lib/session';

interface AddressRow {
  id: string;
  text: string;
  lat: number;
  lng: number;
}

interface StopRow {
  id: string;
  label: string;
  lat: number;
  lng: number;
  addressId: string;
}

/**
 * Adres ve durak, bütün planın temelidir: durak olmadan rota, rota olmadan
 * sefer kurulamaz. Panelde ikisinin de ekranı yoktu — yeni bir servis şirketi
 * açılış günü hiçbir şey oluşturamıyordu.
 */
export default function PlacesPage() {
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [text, setText] = useState('');
  const [il, setIl] = useState('İstanbul');
  const [ilce, setIlce] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const [stopLabel, setStopLabel] = useState('');
  const [stopAddressId, setStopAddressId] = useState('');
  const [stopLat, setStopLat] = useState('');
  const [stopLng, setStopLng] = useState('');

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
        apiFetch<{ items: AddressRow[] }>('/v1/admin/addresses'),
        apiFetch<{ items: StopRow[] }>('/v1/admin/stops'),
      ])
        .then(([a, s]) => {
          if (!alive.current) return;
          setAddresses(a.items);
          setStops(s.items);
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

  function coords(rawLat: string, rawLng: string): { lat: number; lng: number } | null {
    if (!rawLat.trim() || !rawLng.trim()) return null;
    const parsedLat = Number(rawLat.trim());
    const parsedLng = Number(rawLng.trim());
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) return null;
    if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) return null;
    return { lat: parsedLat, lng: parsedLng };
  }

  async function pinAddress() {
    if (text.trim().length < 3 || il.trim().length < 2 || ilce.trim().length < 2) {
      setOk(null);
      setError('Açık adresi, ili ve ilçeyi eksiksiz girin.');
      return;
    }
    const point = coords(lat, lng);
    if (!point) {
      setOk(null);
      setError('Enlem/boylam geçersiz. Harita uygulamasından kopyalayın.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/v1/admin/addresses', {
        method: 'POST',
        body: JSON.stringify({ text: text.trim(), il: il.trim(), ilce: ilce.trim(), ...point }),
      });
      setText('');
      setIlce('');
      setLat('');
      setLng('');
      setError(null);
      setOk('Adres kaydedildi');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Adres kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function createStop() {
    if (stopLabel.trim().length < 2) {
      setOk(null);
      setError('Durak adını en az 2 karakter olarak girin.');
      return;
    }
    const point = coords(stopLat, stopLng);
    if (!point) {
      setOk(null);
      setError('Durak enlem/boylamı geçersiz.');
      return;
    }
    if (!stopAddressId) {
      setOk(null);
      setError('Önce durağın bağlı olduğu adresi seçin.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/v1/admin/stops', {
        method: 'POST',
        body: JSON.stringify({ addressId: stopAddressId, label: stopLabel.trim(), ...point }),
      });
      setStopLabel('');
      setStopLat('');
      setStopLng('');
      setError(null);
      setOk('Durak kaydedildi');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Durak kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">Adres ve durak</h1>
      <p className="mt-1 text-sm text-muted">
        Durak, rotanın yapı taşıdır. Koordinatı harita uygulamasından kopyalayın; sistem tahmin
        etmez.
      </p>
      <Notice error={error} ok={ok} />

      <Card title="Adres pinle">
        <FormGrid onSubmit={pinAddress} busy={busy} submitLabel="Adresi kaydet">
          <TextField
            label="Açık adres"
            value={text}
            onChange={setText}
            placeholder="Mahalle, sokak, no"
          />
          <TextField label="İl" value={il} onChange={setIl} />
          <TextField label="İlçe" value={ilce} onChange={setIlce} />
          <TextField
            label="Enlem"
            value={lat}
            onChange={setLat}
            inputMode="decimal"
            placeholder="40.9819"
          />
          <TextField
            label="Boylam"
            value={lng}
            onChange={setLng}
            inputMode="decimal"
            placeholder="29.0365"
          />
        </FormGrid>
        <ul className="mt-4 divide-y divide-rule border border-rule text-sm">
          {addresses.map((item) => (
            <li key={item.id} className="px-3 py-2">
              {item.text}
              <span className="ml-2 tabular-nums text-muted">
                {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
              </span>
            </li>
          ))}
          {addresses.length === 0 ? (
            <li className="px-3 py-2 text-muted">Henüz adres yok.</li>
          ) : null}
        </ul>
      </Card>

      <Card title="Durak oluştur">
        <FormGrid onSubmit={createStop} busy={busy} submitLabel="Durağı kaydet">
          <TextField
            label="Durak adı"
            value={stopLabel}
            onChange={setStopLabel}
            placeholder="Moda kapı"
            hint="Şoförün ekranda göreceği isim."
          />
          <label className="block text-sm">
            <span className="text-muted">Bağlı adres</span>
            <select
              className="mt-1 w-full rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              value={stopAddressId}
              onChange={(event) => setStopAddressId(event.target.value)}
            >
              <option value="">Seçin…</option>
              {addresses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.text}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Enlem" value={stopLat} onChange={setStopLat} inputMode="decimal" />
          <TextField label="Boylam" value={stopLng} onChange={setStopLng} inputMode="decimal" />
        </FormGrid>
        <ul className="mt-4 divide-y divide-rule border border-rule text-sm">
          {stops.map((item) => (
            <li key={item.id} className="px-3 py-2">
              {item.label}
              <span className="ml-2 tabular-nums text-muted">
                {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
              </span>
            </li>
          ))}
          {stops.length === 0 ? <li className="px-3 py-2 text-muted">Henüz durak yok.</li> : null}
        </ul>
      </Card>
    </div>
  );
}
