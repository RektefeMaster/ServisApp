'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { publicInviteUrl } from '@/lib/invite-link';

interface Guardian {
  membershipId: string;
  identityId: string;
  inviteId: string | null;
  fullName: string;
  phone: string;
  relation: string;
  status: string;
  inviteStatus: string | null;
  smsStatus: string | null;
}

interface Student {
  id: string;
  fullName: string;
  schoolName: string;
  morningPlanStatus: string;
  eveningPlanStatus: string;
  addressVerification: string;
  guardians: Guardian[];
}

export default function StudentDetailPage() {
  const params = useParams<{ studentId: string }>();
  const [student, setStudent] = useState<Student | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [il, setIl] = useState('');
  const [ilce, setIlce] = useState('');
  const [text, setText] = useState('');

  async function reload() {
    setStudent(await apiFetch<Student>(`/v1/admin/students/${params.studentId}`));
  }

  useEffect(() => {
    void apiFetch<Student>(`/v1/admin/students/${params.studentId}`)
      .then(setStudent)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Öğrenci okunamadı'),
      );
  }, [params.studentId]);

  async function pin() {
    const latitude = Number(lat.trim());
    const longitude = Number(lng.trim());
    const province = il.trim();
    const district = ilce.trim();
    if (lat.trim() === '' || lng.trim() === '' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError('Koordinat sayı olmalı');
      return;
    }
    if (province.length < 2 || district.length < 2) {
      setError('İl ve ilçe gerekli');
      return;
    }
    setError(null);
    try {
      await apiFetch('/v1/admin/addresses', {
        method: 'POST',
        body: JSON.stringify({
          text: text || `${student?.fullName} adresi`,
          il: province,
          ilce: district,
          lat: latitude,
          lng: longitude,
          studentId: params.studentId,
        }),
      });
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pin başarısız');
    }
  }

  async function createInvite(membershipId: string) {
    try {
      const created = await apiFetch<{ id: string; inviteUrl: string | null }>('/v1/admin/invites', {
        method: 'POST',
        body: JSON.stringify({ membershipId }),
      });
      setInviteUrl(publicInviteUrl(created.inviteUrl));
      setError(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Davet oluşturulamadı');
    }
  }

  async function sendSms(inviteId: string) {
    try {
      await apiFetch(`/v1/admin/invites/${inviteId}/sms`, { method: 'POST' });
      setError(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'SMS gönderilemedi');
    }
  }

  if (error && !student) return <p className="text-sm text-red-700">{error}</p>;
  if (!student) return <p className="text-sm text-muted">Yükleniyor…</p>;

  const pinLat = Number(lat.trim());
  const pinLng = Number(lng.trim());
  const mapReady =
    lat.trim() !== '' && lng.trim() !== '' && Number.isFinite(pinLat) && Number.isFinite(pinLng);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-serif text-2xl">{student.fullName}</h1>
        <p className="text-sm text-muted">{student.schoolName}</p>
      </section>
      <section className="border border-rule bg-white p-4">
        <h2 className="text-sm font-medium">Kimlik</h2>
        <p className="mt-2 text-sm">{student.fullName}</p>
      </section>
      <section className="border border-rule bg-white p-4">
        <h2 className="text-sm font-medium">İletişim / veli</h2>
        <ul className="mt-2 text-sm">
          {student.guardians.map((item) => (
            <li key={item.membershipId} className="py-2">
              {item.fullName} · {item.phone} · ilişki {item.relation} · {item.status}
            </li>
          ))}
        </ul>
      </section>
      <section className="border border-rule bg-white p-4">
        <h2 className="text-sm font-medium">Aktivasyon</h2>
        <p className="mt-1 text-xs text-muted">Davet üyelik açar; SMS ayrı kuryedir.</p>
        <ul className="mt-2 text-sm">
          {student.guardians.map((item) => (
            <li key={item.membershipId} className="flex justify-between gap-4 py-2">
              <span>
                {item.fullName}
                <br />
                <span className="text-xs text-muted">
                  davet {item.inviteStatus ?? 'yok'} · SMS {item.smsStatus ?? 'yok'}
                </span>
              </span>
              {item.status === 'ACTIVE' ? (
                <span className="flex shrink-0 gap-3">
                  <button type="button" className="underline" onClick={() => void createInvite(item.membershipId)}>
                    Davet
                  </button>
                  {item.inviteId && item.inviteStatus === 'PENDING' ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        const inviteId = item.inviteId;
                        if (inviteId) void sendSms(inviteId);
                      }}
                    >
                      SMS
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {inviteUrl ? <p className="mt-2 break-all text-xs text-muted">{inviteUrl}</p> : null}
      </section>
      <section className="border border-rule bg-white p-4">
        <h2 className="text-sm font-medium">Operasyon — adres pin</h2>
        <p className="mt-1 text-xs text-muted">Excel metni koordinat değildir. Pin güvenilir noktayı kilitler.</p>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <input
            className="rounded border border-rule px-2 py-1"
            placeholder="Adres"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <input
            className="w-28 rounded border border-rule px-2 py-1"
            placeholder="İl"
            value={il}
            onChange={(event) => setIl(event.target.value)}
          />
          <input
            className="w-28 rounded border border-rule px-2 py-1"
            placeholder="İlçe"
            value={ilce}
            onChange={(event) => setIlce(event.target.value)}
          />
          <input
            className="w-24 rounded border border-rule px-2 py-1"
            placeholder="Enlem"
            value={lat}
            onChange={(event) => setLat(event.target.value)}
          />
          <input
            className="w-24 rounded border border-rule px-2 py-1"
            placeholder="Boylam"
            value={lng}
            onChange={(event) => setLng(event.target.value)}
          />
          <button type="button" className="rounded bg-ink px-3 py-1 text-paper" onClick={() => void pin()}>
            Pinle
          </button>
        </div>
        {mapReady ? (
          <iframe
            title="Pin haritası"
            className="mt-3 h-56 w-full border border-rule"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${pinLng - 0.01}%2C${pinLat - 0.01}%2C${pinLng + 0.01}%2C${pinLat + 0.01}&layer=mapnik&marker=${pinLat}%2C${pinLng}`}
          />
        ) : (
          <p className="mt-3 text-sm text-red-700">Harita için geçerli koordinat girin.</p>
        )}
        <p className="mt-2 text-sm text-muted">
          Sabah {student.morningPlanStatus} · Akşam {student.eveningPlanStatus} · {student.addressVerification}
        </p>
      </section>
    </div>
  );
}
