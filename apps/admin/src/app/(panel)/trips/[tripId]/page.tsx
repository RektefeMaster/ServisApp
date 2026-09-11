'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/session';

interface LivePoint {
  lat: number;
  lng: number;
  recordedAt: string;
  isStale: boolean;
}

interface TripStop {
  id: string;
  seq: number;
  kind: string;
  label: string;
  lat: number;
  lng: number;
}

interface TripStudent {
  id: string;
  studentId: string;
  fullName: string;
  state: string;
  deliveryTarget?: string;
  deliveryVerified?: boolean;
}

interface TripDetail {
  id: string;
  routeId: string;
  plate: string;
  schoolName: string;
  state: string;
  segment: string;
  serviceDate: string;
  seatCount: number;
  driverMembershipId: string | null;
  attendantMembershipId: string | null;
  driverName: string | null;
  attendantName: string | null;
  locationSessionEpoch: number;
  students: TripStudent[];
  stops: TripStop[];
  live: LivePoint | null;
}

interface OverrideRow {
  id: string;
  studentId: string;
  status: string;
}

interface VehicleRow {
  id: string;
  plate: string;
  seatCount: number;
}

interface StaffRow {
  membershipId: string;
  fullName: string;
  roles: string[];
}

interface RouteRow {
  id: string;
  segment: string;
  shiftNo: number;
  vehicleId: string;
  publishedVersionId: string | null;
}

function pad(points: Array<{ lat: number; lng: number }>) {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latPad = Math.max(0.004, (maxLat - minLat) * 0.35);
  const lngPad = Math.max(0.004, (maxLng - minLng) * 0.35);
  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
}

function toPercent(
  point: { lat: number; lng: number },
  bounds: ReturnType<typeof pad>,
): { left: number; top: number } {
  const latSpan = Math.max(0.0001, bounds.maxLat - bounds.minLat);
  const lngSpan = Math.max(0.0001, bounds.maxLng - bounds.minLng);
  return {
    left: ((point.lng - bounds.minLng) / lngSpan) * 100,
    top: (1 - (point.lat - bounds.minLat) / latSpan) * 100,
  };
}

function LiveSchematic({ trip }: { trip: TripDetail }) {
  const points = useMemo(() => {
    const next: Array<{ lat: number; lng: number }> = trip.stops.map((stop) => ({
      lat: stop.lat,
      lng: stop.lng,
    }));
    if (trip.live) next.push({ lat: trip.live.lat, lng: trip.live.lng });
    return next;
  }, [trip.live, trip.stops]);

  if (points.length === 0) {
    return <p className="mt-2 text-sm text-muted">Haritada durak yok.</p>;
  }

  const bounds = pad(points);
  const livePos = trip.live ? toPercent({ lat: trip.live.lat, lng: trip.live.lng }, bounds) : null;
  return (
    <div
      className="relative mt-3 h-64 overflow-hidden rounded-md border border-rule bg-ink"
      aria-label="Canlı harita: araç ve duraklar"
    >
      {trip.stops.map((stop) => {
        const pos = toPercent({ lat: stop.lat, lng: stop.lng }, bounds);
        return (
          <span
            key={stop.id}
            className="absolute -ml-1.5 -mt-1.5 text-xs text-paper"
            style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
            title={stop.label}
          >
            ■
          </span>
        );
      })}
      {livePos && trip.live ? (
        <span
          className={`absolute -ml-1.5 -mt-1.5 text-sm ${trip.live.isStale ? 'text-stripe' : 'text-paper'}`}
          style={{ left: `${livePos.left}%`, top: `${livePos.top}%` }}
        >
          ●
        </span>
      ) : null}
      <p className="absolute bottom-2 left-3 right-3 text-xs text-paper/80">
        {trip.live
          ? trip.live.isStale
            ? 'Konum gecikti; eski nokta canlı gibi gösterilmez.'
            : `Canlı · ${new Date(trip.live.recordedAt).toLocaleTimeString('tr-TR')}`
          : 'Araçtan konum yok. Yan menüde ayrı harita maddesi yoktur.'}
      </p>
    </div>
  );
}

export default function TripDetailPage() {
  const params = useParams<{ tripId: string }>();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleReason, setVehicleReason] = useState('Araç arızası');
  const [crewRole, setCrewRole] = useState<'DRIVER' | 'ATTENDANT'>('DRIVER');
  const [crewMembershipId, setCrewMembershipId] = useState('');
  const [crewReason, setCrewReason] = useState('Personel değişimi');
  const [moveStudentId, setMoveStudentId] = useState('');
  const [moveRouteId, setMoveRouteId] = useState('');
  const [moveReason, setMoveReason] = useState('Öğrenci başka araca alındı');

  const tripId = params.tripId;

  const loadTrip = useCallback(async () => {
    const next = await apiFetch<TripDetail>(`/v1/admin/trips/${tripId}`);
    const listed = await apiFetch<{ overrides: OverrideRow[] }>('/v1/admin/exceptions');
    return { next, overrides: listed.overrides };
  }, [tripId]);

  const reload = useCallback(async () => {
    const loaded = await loadTrip();
    setTrip(loaded.next);
    setOverrides(loaded.overrides);
  }, [loadTrip]);

  useEffect(() => {
    let cancelled = false;
    void loadTrip()
      .then((loaded) => {
        if (cancelled) return;
        setTrip(loaded.next);
        setOverrides(loaded.overrides);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Okunamadı');
      });
    return () => {
      cancelled = true;
    };
  }, [loadTrip]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch<{ items: VehicleRow[] }>('/v1/admin/vehicles'),
      apiFetch<{ items: StaffRow[] }>('/v1/admin/staff'),
      apiFetch<{ items: RouteRow[] }>('/v1/admin/routes'),
    ])
      .then(([v, s, r]) => {
        if (cancelled) return;
        setVehicles(v.items);
        setStaff(s.items);
        setRoutes(r.items);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Filo okunamadı');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (trip?.state !== 'ACTIVE') return;
    const timer = window.setInterval(() => {
      void reload().catch(() => undefined);
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [reload, trip?.state]);

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

  async function adminVerify(student: TripStudent) {
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

  async function assignVehicle(event: FormEvent) {
    event.preventDefault();
    if (!vehicleId) return;
    try {
      await apiFetch(`/v1/admin/trips/${params.tripId}/vehicle`, {
        method: 'POST',
        body: JSON.stringify({ vehicleId, reason: vehicleReason }),
      });
      setError(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Araç atanamadı');
    }
  }

  async function assignCrew(event: FormEvent) {
    event.preventDefault();
    if (!crewMembershipId) return;
    try {
      await apiFetch(`/v1/admin/trips/${params.tripId}/crew`, {
        method: 'POST',
        body: JSON.stringify({
          role: crewRole,
          membershipId: crewMembershipId,
          reason: crewReason,
        }),
      });
      setError(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Personel atanamadı');
    }
  }

  async function transferStudent(event: FormEvent) {
    event.preventDefault();
    if (!trip || !moveStudentId || !moveRouteId) return;
    try {
      await apiFetch('/v1/admin/trip-moves', {
        method: 'POST',
        body: JSON.stringify({
          studentId: moveStudentId,
          serviceDate: trip.serviceDate,
          segment: trip.segment,
          targetRouteId: moveRouteId,
          reason: moveReason,
        }),
      });
      setError(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Transfer başarısız');
    }
  }

  if (!trip && error) return <p className="text-sm text-red-700">{error}</p>;
  if (!trip) return <p className="text-sm text-muted">Yükleniyor…</p>;

  const openTrip = trip.state === 'PLANNED' || trip.state === 'READY' || trip.state === 'ACTIVE';
  const crewOptions = staff.filter((row) => row.roles.includes(crewRole));
  const targetRoutes = routes.filter(
    (row) => row.segment === trip.segment && row.id !== trip.routeId && row.publishedVersionId,
  );
  const movable = trip.students.filter(
    (row) => row.state === 'EXPECTED' || row.state === 'ABSENT_PLANNED',
  );

  return (
    <div>
      <h1 className="font-serif text-2xl">
        {trip.plate} · {trip.schoolName}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {trip.segment === 'MORNING' ? 'Sabah' : 'Akşam'} · {trip.state} · {trip.seatCount} koltuk
        {trip.driverName ? ` · şoför ${trip.driverName}` : ''}
        {trip.attendantName ? ` · hostes ${trip.attendantName}` : ''}
      </p>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <section className="mt-8 border border-dashed border-rule bg-white px-4 py-6">
        <h2 className="text-sm font-medium">Canlı</h2>
        <LiveSchematic trip={trip} />
      </section>
      {openTrip ? (
        <section className="mt-8 grid gap-6 md:grid-cols-2">
          <form
            onSubmit={(event) => void assignVehicle(event)}
            className="border border-rule bg-white p-4"
          >
            <h2 className="text-sm font-medium">Araç değiştir</h2>
            <select
              className="mt-3 w-full rounded border border-rule bg-white px-2 py-1 text-sm"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
            >
              <option value="">Araç seç</option>
              {vehicles.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.plate} · {row.seatCount} koltuk
                </option>
              ))}
            </select>
            <input
              className="mt-2 w-full rounded border border-rule px-2 py-1 text-sm"
              value={vehicleReason}
              onChange={(event) => setVehicleReason(event.target.value)}
            />
            <button className="mt-3 rounded bg-ink px-3 py-1 text-sm text-paper" type="submit">
              Kaydet
            </button>
          </form>
          <form
            onSubmit={(event) => void assignCrew(event)}
            className="border border-rule bg-white p-4"
          >
            <h2 className="text-sm font-medium">Personel değiştir</h2>
            <select
              className="mt-3 w-full rounded border border-rule bg-white px-2 py-1 text-sm"
              value={crewRole}
              onChange={(event) => {
                setCrewRole(event.target.value === 'ATTENDANT' ? 'ATTENDANT' : 'DRIVER');
                setCrewMembershipId('');
              }}
            >
              <option value="DRIVER">Şoför</option>
              <option value="ATTENDANT">Hostes</option>
            </select>
            <select
              className="mt-2 w-full rounded border border-rule bg-white px-2 py-1 text-sm"
              value={crewMembershipId}
              onChange={(event) => setCrewMembershipId(event.target.value)}
            >
              <option value="">Personel seç</option>
              {crewOptions.map((row) => (
                <option key={row.membershipId} value={row.membershipId}>
                  {row.fullName}
                </option>
              ))}
            </select>
            <input
              className="mt-2 w-full rounded border border-rule px-2 py-1 text-sm"
              value={crewReason}
              onChange={(event) => setCrewReason(event.target.value)}
            />
            <button className="mt-3 rounded bg-ink px-3 py-1 text-sm text-paper" type="submit">
              Kaydet
            </button>
          </form>
          <form
            onSubmit={(event) => void transferStudent(event)}
            className="border border-rule bg-white p-4 md:col-span-2"
          >
            <h2 className="text-sm font-medium">Öğrenciyi başka sefere al</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <select
                className="rounded border border-rule bg-white px-2 py-1 text-sm"
                value={moveStudentId}
                onChange={(event) => setMoveStudentId(event.target.value)}
              >
                <option value="">Öğrenci</option>
                {movable.map((row) => (
                  <option key={row.studentId} value={row.studentId}>
                    {row.fullName}
                  </option>
                ))}
              </select>
              <select
                className="rounded border border-rule bg-white px-2 py-1 text-sm"
                value={moveRouteId}
                onChange={(event) => setMoveRouteId(event.target.value)}
              >
                <option value="">Hedef rota</option>
                {targetRoutes.map((row) => (
                  <option key={row.id} value={row.id}>
                    {vehicles.find((vehicle) => vehicle.id === row.vehicleId)?.plate ?? 'Rota'}
                    {' · '}
                    {row.segment === 'MORNING' ? 'Sabah' : 'Akşam'} {row.shiftNo}
                  </option>
                ))}
              </select>
            </div>
            <input
              className="mt-2 w-full rounded border border-rule px-2 py-1 text-sm"
              value={moveReason}
              onChange={(event) => setMoveReason(event.target.value)}
            />
            <button className="mt-3 rounded bg-ink px-3 py-1 text-sm text-paper" type="submit">
              Transfer et
            </button>
          </form>
        </section>
      ) : null}
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
                <button
                  type="button"
                  className="underline"
                  onClick={() => void adminVerify(student)}
                >
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
