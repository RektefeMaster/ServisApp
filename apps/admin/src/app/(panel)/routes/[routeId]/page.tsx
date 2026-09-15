'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Notice, TextField, confirmDestructive } from '@/components/form';
import { apiFetch } from '@/lib/session';
import { formatDate, segmentLabel, versionStatusLabel } from '@/lib/labels';

interface RouteDetail {
  id: string;
  segment: 'MORNING' | 'AFTERNOON';
  shiftNo: number;
  departureLocalTime: string;
  retiredAt: string | null;
  versions: Array<{ id: string; status: string; versionNo: number; effectiveFrom: string }>;
}

interface StopRow {
  id: string;
  seq: number;
  kind: 'PICKUP' | 'DROPOFF' | 'SCHOOL';
  stopId: string;
  label: string;
  studentIds: string[];
}

interface VersionView {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  versionNo: number;
  effectiveFrom: string;
  seatCount: number;
  stops: StopRow[];
}

interface CatalogStop {
  id: string;
  label: string;
}

interface StudentRow {
  id: string;
  fullName: string;
  schoolId: string;
}

/** Taslakta düzenlenen durak satırı. */
interface DraftStop {
  stopId: string;
  kind: 'PICKUP' | 'DROPOFF' | 'SCHOOL';
  studentIds: string[];
}

/**
 * Rota sürümü düzenleyicisi.
 *
 * Ürünün çekirdeği burasıdır: durak eklemek, sırasını değiştirmek, türünü
 * seçmek ve öğrenci bağlamak. Panelde hiç yoktu — rota yalnız salt okunur
 * görünüyordu, yani sistem tek bir gerçek rota ile bile kurulamıyordu.
 */
export default function RouteDetailPage() {
  const params = useParams<{ routeId: string }>();
  const routeId = params.routeId;

  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [version, setVersion] = useState<VersionView | null>(null);
  const [draft, setDraft] = useState<DraftStop[]>([]);
  const [catalog, setCatalog] = useState<CatalogStop[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [departure, setDeparture] = useState('');

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const applyVersion = useCallback((next: VersionView) => {
    setVersion(next);
    setDraft(
      [...next.stops]
        .sort((left, right) => left.seq - right.seq)
        .map((stop) => ({
          stopId: stop.stopId,
          kind: stop.kind,
          studentIds: [...stop.studentIds],
        })),
    );
  }, []);

  const reload = useCallback(
    (): Promise<void> =>
      apiFetch<RouteDetail>(`/v1/admin/routes/${routeId}`)
        .then(async (detail) => {
          if (!alive.current) return;
          setRoute(detail);
          setDeparture(detail.departureLocalTime);
          const editable =
            detail.versions.find((item) => item.status === 'DRAFT') ??
            detail.versions.find((item) => item.status === 'PUBLISHED') ??
            detail.versions.at(-1);
          if (!editable) return;
          const [view, stopList, studentList] = await Promise.all([
            apiFetch<VersionView>(`/v1/admin/route-versions/${editable.id}`),
            apiFetch<{ items: CatalogStop[] }>('/v1/admin/stops'),
            apiFetch<{ items: StudentRow[] }>('/v1/admin/students'),
          ]);
          if (!alive.current) return;
          applyVersion(view);
          setCatalog(stopList.items);
          setStudents(studentList.items);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (!alive.current) return;
          setError(caught instanceof Error ? caught.message : 'Rota okunamadı');
        }),
    [routeId, applyVersion],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const isDraft = version?.status === 'DRAFT';

  function move(index: number, delta: number) {
    setDraft((current) => {
      const next = [...current];
      const target = index + delta;
      const a = next[index];
      const b = next[target];
      if (!a || !b) return current;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }

  function addStop() {
    const firstUnused = catalog.find((item) => !draft.some((row) => row.stopId === item.id));
    if (!firstUnused) {
      setError('Eklenecek başka durak yok. Önce "Adres ve durak" ekranından durak oluşturun.');
      return;
    }
    setDraft((current) => [
      ...current,
      {
        stopId: firstUnused.id,
        kind: route?.segment === 'MORNING' ? 'PICKUP' : 'DROPOFF',
        studentIds: [],
      },
    ]);
  }

  function updateStop(index: number, patch: Partial<DraftStop>) {
    setDraft((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function toggleStudent(index: number, studentId: string) {
    setDraft((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const has = row.studentIds.includes(studentId);
        return {
          ...row,
          studentIds: has
            ? row.studentIds.filter((id) => id !== studentId)
            : [...row.studentIds, studentId],
        };
      }),
    );
  }

  async function saveStops() {
    if (!version) return;
    if (draft.length === 0) {
      setError('En az bir durak gerekir.');
      return;
    }
    setBusy(true);
    try {
      const saved = await apiFetch<VersionView>(`/v1/admin/route-versions/${version.id}/stops`, {
        method: 'PUT',
        body: JSON.stringify({
          stops: draft.map((row, index) => ({
            stopId: row.stopId,
            kind: row.kind,
            seq: index + 1,
            studentIds: row.studentIds,
          })),
        }),
      });
      applyVersion(saved);
      setError(null);
      setOk('Duraklar kaydedildi');
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Duraklar kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function suggestOrder() {
    if (!version) return;
    setBusy(true);
    try {
      const suggested = await apiFetch<VersionView>(
        `/v1/admin/route-versions/${version.id}/suggest-order`,
        { method: 'POST' },
      );
      applyVersion(suggested);
      setError(null);
      setOk('Sıra önerildi. Uygunsa kaydedin.');
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Sıra önerilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!version) return;
    setBusy(true);
    try {
      const published = await apiFetch<VersionView>(
        `/v1/admin/route-versions/${version.id}/publish`,
        { method: 'POST' },
      );
      applyVersion(published);
      setError(null);
      setOk('Rota yayınlandı. Üretilmiş gelecek seferler yeni plana çekildi.');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Yayın başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function newDraft() {
    setBusy(true);
    try {
      await apiFetch<{ id: string }>(`/v1/admin/routes/${routeId}/versions`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setError(null);
      setOk('Yayınlı sürümden yeni taslak kopyalandı.');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Taslak açılamadı');
    } finally {
      setBusy(false);
    }
  }

  async function saveDeparture() {
    setBusy(true);
    try {
      await apiFetch(`/v1/admin/routes/${routeId}/departure`, {
        method: 'PUT',
        body: JSON.stringify({ departureLocalTime: departure }),
      });
      setError(null);
      setOk('Kalkış saati güncellendi; üretilmiş seferler de kaydı.');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Kalkış saati değiştirilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function setLifecycle(next: 'ACTIVE' | 'RETIRED') {
    if (
      next === 'RETIRED' &&
      !confirmDestructive(
        'Bu güzergâh emekliye ayrılacak: yeni sefer üretmez ve henüz başlamamış seferleri iptal edilir. Onaylıyor musunuz?',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/v1/admin/routes/${routeId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: next }),
      });
      setError(null);
      setOk(next === 'RETIRED' ? 'Güzergâh emekliye ayrıldı' : 'Güzergâh yeniden açıldı');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Durum değiştirilemedi');
    } finally {
      setBusy(false);
    }
  }

  if (!route) {
    return (
      <p className={`text-sm ${error ? 'text-red-700' : 'text-muted'}`}>{error ?? 'Yükleniyor…'}</p>
    );
  }

  const schoolStudents = students;

  return (
    <div>
      <h1 className="font-serif text-2xl">
        {segmentLabel(route.segment)} rotası · {route.shiftNo}. vardiya
      </h1>
      <p className="mt-1 text-sm text-muted">
        {version
          ? `Sürüm ${String(version.versionNo)} · ${versionStatusLabel(version.status)}`
          : 'Sürüm yok'}{' '}
        · {route.retiredAt ? 'emekli' : 'aktif'}
      </p>
      <Notice error={error} ok={ok} />

      <Card title="Kalkış saati">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <TextField label="Saat" value={departure} onChange={setDeparture} type="time" />
          </div>
          <button
            type="button"
            disabled={busy}
            className="rounded bg-ink px-3 py-1 text-sm text-paper disabled:opacity-50"
            onClick={() => void saveDeparture()}
          >
            Kaydet
          </button>
          <button
            type="button"
            disabled={busy}
            className={`ml-auto text-sm underline disabled:opacity-50 ${
              route.retiredAt ? '' : 'text-red-700'
            }`}
            onClick={() => void setLifecycle(route.retiredAt ? 'ACTIVE' : 'RETIRED')}
          >
            {route.retiredAt ? 'Güzergâhı yeniden aç' : 'Güzergâhı emekliye ayır'}
          </button>
        </div>
      </Card>

      <Card title="Duraklar ve öğrenciler">
        {!isDraft ? (
          <p className="mb-3 text-sm text-muted">
            Yayınlı sürüm düzenlenemez. Değişiklik için yayınlı sürümden yeni bir taslak kopyalayın.
          </p>
        ) : null}
        <ol className="divide-y divide-rule border border-rule">
          {draft.map((row, index) => (
            <li key={`${row.stopId}-${String(index)}`} className="px-3 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-6 tabular-nums text-muted">{index + 1}.</span>
                <select
                  className="rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  disabled={!isDraft}
                  value={row.stopId}
                  onChange={(event) => updateStop(index, { stopId: event.target.value })}
                >
                  {catalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded border border-field bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  disabled={!isDraft}
                  value={row.kind}
                  onChange={(event) =>
                    updateStop(index, { kind: event.target.value as DraftStop['kind'] })
                  }
                >
                  <option value="PICKUP">Bindirme</option>
                  <option value="DROPOFF">İndirme</option>
                  <option value="SCHOOL">Okul</option>
                </select>
                <span className="text-muted">{row.studentIds.length} öğrenci</span>
                {isDraft ? (
                  <span className="ml-auto flex gap-2">
                    <button
                      type="button"
                      className="underline disabled:opacity-40"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      Yukarı
                    </button>
                    <button
                      type="button"
                      className="underline disabled:opacity-40"
                      disabled={index === draft.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      Aşağı
                    </button>
                    <button
                      type="button"
                      className="text-red-700 underline"
                      onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}
                    >
                      Çıkar
                    </button>
                  </span>
                ) : null}
              </div>
              {isDraft && row.kind !== 'SCHOOL' ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-8 text-xs">
                  {schoolStudents.map((student) => (
                    <label key={student.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={row.studentIds.includes(student.id)}
                        onChange={() => toggleStudent(index, student.id)}
                      />
                      {student.fullName}
                    </label>
                  ))}
                  {schoolStudents.length === 0 ? (
                    <span className="text-muted">Öğrenci yok.</span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
          {draft.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted">Durak yok. Aşağıdan durak ekleyin.</li>
          ) : null}
        </ol>

        <div className="mt-3 flex flex-wrap gap-2">
          {isDraft ? (
            <>
              <button
                type="button"
                className="rounded border border-rule px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                onClick={addStop}
              >
                Durak ekle
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded border border-rule px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
                onClick={() => void suggestOrder()}
              >
                Sıra öner
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded bg-ink px-3 py-1 text-sm text-paper disabled:opacity-50"
                onClick={() => void saveStops()}
              >
                Durakları kaydet
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded bg-ink px-3 py-1 text-sm text-paper disabled:opacity-50"
                onClick={() => void publish()}
              >
                Yayınla
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy || Boolean(route.retiredAt)}
              className="rounded border border-rule px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
              onClick={() => void newDraft()}
            >
              Yeni taslak aç
            </button>
          )}
        </div>
      </Card>

      <Card title="Sürümler">
        <ul className="divide-y divide-rule border border-rule text-sm">
          {route.versions.map((item) => (
            <li key={item.id} className="px-3 py-2">
              Sürüm {item.versionNo} · {versionStatusLabel(item.status)} ·{' '}
              {formatDate(item.effectiveFrom)} tarihinden geçerli
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
