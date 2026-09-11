'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';

interface RouteDetail {
  id: string;
  segment: string;
  versions: Array<{ id: string; status: string; versionNo: number }>;
}

interface VersionView {
  id: string;
  status: string;
  stops: Array<{ seq: number; label: string; kind: string; studentIds: string[] }>;
}

export default function RouteDetailPage() {
  const params = useParams<{ routeId: string }>();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [version, setVersion] = useState<VersionView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const detail = await apiFetch<RouteDetail>(`/v1/admin/routes/${params.routeId}`);
        setRoute(detail);
        const draft = detail.versions.find((item) => item.status === 'DRAFT') ?? detail.versions.at(-1);
        if (draft) {
          setVersion(await apiFetch<VersionView>(`/v1/admin/route-versions/${draft.id}`));
        }
      } catch (caught) {
        setMessage(caught instanceof Error ? caught.message : 'Rota okunamadı');
      }
    })();
  }, [params.routeId]);

  async function publish() {
    if (!version) return;
    try {
      const published = await apiFetch<VersionView>(`/v1/admin/route-versions/${version.id}/publish`, {
        method: 'POST',
      });
      const detail = await apiFetch<RouteDetail>(`/v1/admin/routes/${params.routeId}`);
      setRoute(detail);
      setVersion(published);
      setMessage('Rota yayınlandı');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Yayın başarısız');
    }
  }

  if (!route) {
    return (
      <p className={`text-sm ${message ? 'text-red-700' : 'text-muted'}`}>{message ?? 'Yükleniyor…'}</p>
    );
  }

  return (
    <div>
      <h1 className="font-serif text-2xl">{route.segment === 'MORNING' ? 'Sabah' : 'Akşam'} rotası</h1>
      {message ? <p className="mt-2 text-sm">{message}</p> : null}
      <ol className="mt-6 list-decimal border border-rule bg-white px-8 py-4 text-sm">
        {version?.stops.map((stop) => (
          <li key={stop.seq} className="py-1">
            {stop.label} · {stop.kind} · {stop.studentIds.length} öğrenci
          </li>
        ))}
      </ol>
      {version?.status === 'DRAFT' ? (
        <button type="button" className="mt-4 rounded bg-ink px-3 py-2 text-sm text-paper" onClick={() => void publish()}>
          Yayınla
        </button>
      ) : null}
    </div>
  );
}
