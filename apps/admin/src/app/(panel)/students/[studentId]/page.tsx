'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { publicInviteUrl } from '@/lib/invite-link';
import { CheckField, FormGrid, Notice, TextField, confirmDestructive } from '@/components/form';
import { planStatusLabel, relationStatusLabel } from '@/lib/labels';

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
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const [gName, setGName] = useState('');
  const [gPhone, setGPhone] = useState('+90');
  const [gRelation, setGRelation] = useState('Anne');
  const [gPrimary, setGPrimary] = useState(false);
  const [gReceive, setGReceive] = useState(true);
  const [gAuthorize, setGAuthorize] = useState(false);
  const [gException, setGException] = useState(true);
  const [endDate, setEndDate] = useState('');

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
    if (
      lat.trim() === '' ||
      lng.trim() === '' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
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

  async function addGuardian() {
    if (gName.trim().length < 2 || gPhone.trim().length < 10) {
      setError('Veli adı ve telefonu gerekli.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/v1/admin/students/${params.studentId}/guardians`, {
        method: 'POST',
        body: JSON.stringify({
          fullName: gName.trim(),
          phone: gPhone.trim(),
          relation: gRelation.trim(),
          isPrimary: gPrimary,
          canReceiveChild: gReceive,
          canAuthorizeTempAddress: gAuthorize,
          canSubmitException: gException,
        }),
      });
      setGName('');
      setGPhone('+90');
      setError(null);
      setOk('Veli eklendi. Davet göndererek uygulamayı açmasını sağlayın.');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Veli eklenemedi');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Yanlışlıkla kaldırılan veliyi geri açar.
   *
   * "Veli ekle" formu bunu YAPMAZ: iptal edilmiş ilişki sessizce açılmaz
   * (ürün kararı). Ama geri almanın açık bir yolu da yoktu; tek tıkla
   * geri alınamayan bu işlem ürün içinde onarılamıyordu.
   */
  async function restoreGuardian(membershipId: string, name: string) {
    if (
      !confirmDestructive(
        `${name} yeniden veli olacak: canlı konumu görebilir ve çocuğu teslim alabilir. Onaylıyor musunuz?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/v1/admin/students/${params.studentId}/guardians/${membershipId}/restore`, {
        method: 'POST',
      });
      setError(null);
      setOk(`${name} yeniden veli olarak açıldı`);
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Veli geri açılamadı');
    } finally {
      setBusy(false);
    }
  }

  async function revokeGuardian(membershipId: string, name: string) {
    if (
      !confirmDestructive(
        `${name} bu çocuğun velisi olmaktan çıkarılacak: canlı konumu göremez, çocuğu teslim alamaz. Onaylıyor musunuz?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/v1/admin/students/${params.studentId}/guardians/${membershipId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ status: 'REVOKED' }),
      });
      setError(null);
      setOk(`${name} velilikten çıkarıldı`);
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Veli çıkarılamadı');
    } finally {
      setBusy(false);
    }
  }

  async function endEnrollment() {
    if (!endDate) {
      setError('Ayrılış tarihi seçin.');
      return;
    }
    if (
      !confirmDestructive(
        `Öğrencinin kaydı ${endDate} tarihinde bitecek ve sonrasında sefer planına girmeyecek. Onaylıyor musunuz?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/v1/admin/students/${params.studentId}/end`, {
        method: 'POST',
        body: JSON.stringify({ enrollmentEnd: endDate }),
      });
      setError(null);
      setOk('Kayıt sonlandırıldı');
      await reload();
    } catch (caught) {
      setOk(null);
      setError(caught instanceof Error ? caught.message : 'Kayıt sonlandırılamadı');
    } finally {
      setBusy(false);
    }
  }

  async function createInvite(membershipId: string) {
    try {
      const created = await apiFetch<{ id: string; inviteUrl: string | null }>(
        '/v1/admin/invites',
        {
          method: 'POST',
          body: JSON.stringify({ membershipId }),
        },
      );
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
        <Notice error={error} ok={ok} />
        <ul className="mt-2 divide-y divide-rule text-sm">
          {student.guardians.map((item) => (
            <li key={item.membershipId} className="flex flex-wrap items-center gap-2 py-2">
              <span>
                {item.fullName} · {item.phone} · ilişki {item.relation} ·{' '}
                {relationStatusLabel(item.status)}
              </span>
              {item.status === 'ACTIVE' ? (
                <button
                  type="button"
                  disabled={busy}
                  className="ml-auto text-red-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
                  onClick={() => void revokeGuardian(item.membershipId, item.fullName)}
                >
                  Velilikten çıkar
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  className="ml-auto underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
                  onClick={() => void restoreGuardian(item.membershipId, item.fullName)}
                >
                  Erişimi geri aç
                </button>
              )}
            </li>
          ))}
          {student.guardians.length === 0 ? (
            <li className="py-2 text-muted">Henüz veli yok.</li>
          ) : null}
        </ul>
        <div className="mt-4 border-t border-rule pt-4">
          <h3 className="text-sm font-medium">Veli ekle</h3>
          <FormGrid onSubmit={addGuardian} busy={busy} submitLabel="Veliyi ekle">
            <TextField label="Ad soyad" value={gName} onChange={setGName} />
            <TextField label="Telefon" value={gPhone} onChange={setGPhone} type="tel" />
            <TextField label="Yakınlık" value={gRelation} onChange={setGRelation} />
            <div className="flex flex-col gap-2 pt-6">
              <CheckField label="Birincil veli" checked={gPrimary} onChange={setGPrimary} />
              <CheckField
                label="Çocuğu teslim alabilir"
                checked={gReceive}
                onChange={setGReceive}
              />
              <CheckField
                label="Farklı teslimat talebi açabilir"
                checked={gAuthorize}
                onChange={setGAuthorize}
                hint="Teslim kodunun kime gideceğini bu veli belirler."
              />
              <CheckField
                label="Devamsızlık bildirebilir"
                checked={gException}
                onChange={setGException}
              />
            </div>
          </FormGrid>
        </div>
      </section>

      <section className="border border-rule bg-white p-4">
        <h2 className="text-sm font-medium">Kaydı sonlandır</h2>
        <p className="mt-1 text-xs text-muted">
          Okuldan ayrılan öğrenci bu tarihten sonra sefer planına girmez.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-48">
            <TextField label="Ayrılış tarihi" value={endDate} onChange={setEndDate} type="date" />
          </div>
          <button
            type="button"
            disabled={busy}
            className="rounded border border-rule px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
            onClick={() => void endEnrollment()}
          >
            Kaydı sonlandır
          </button>
        </div>
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
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void createInvite(item.membershipId)}
                  >
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
        <p className="mt-1 text-xs text-muted">
          Excel metni koordinat değildir. Pin güvenilir noktayı kilitler.
        </p>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <input
            className="rounded border border-field bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            placeholder="Adres"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <input
            className="w-28 rounded border border-field bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            placeholder="İl"
            value={il}
            onChange={(event) => setIl(event.target.value)}
          />
          <input
            className="w-28 rounded border border-field bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            placeholder="İlçe"
            value={ilce}
            onChange={(event) => setIlce(event.target.value)}
          />
          <input
            className="w-24 rounded border border-field bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            placeholder="Enlem"
            value={lat}
            onChange={(event) => setLat(event.target.value)}
          />
          <input
            className="w-24 rounded border border-field bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            placeholder="Boylam"
            value={lng}
            onChange={(event) => setLng(event.target.value)}
          />
          <button
            type="button"
            className="rounded bg-ink px-3 py-1 text-paper"
            onClick={() => void pin()}
          >
            Pinle
          </button>
        </div>
        {mapReady ? (
          <iframe
            title="Pin haritası"
            className="mt-3 h-56 w-full border border-rule"
            /* Çocuğun ev koordinatı üçüncü tarafa gidiyor: en azından hangi
               sayfadan geldiğimiz sızmasın ve çerçeve yalıtılsın. */
            referrerPolicy="no-referrer"
            sandbox="allow-scripts"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${pinLng - 0.01}%2C${pinLat - 0.01}%2C${pinLng + 0.01}%2C${pinLat + 0.01}&layer=mapnik&marker=${pinLat}%2C${pinLng}`}
          />
        ) : (
          <p className="mt-3 text-sm text-red-700">Harita için geçerli koordinat girin.</p>
        )}
        <p className="mt-2 text-sm text-muted">
          Sabah {planStatusLabel(student.morningPlanStatus)} · Akşam{' '}
          {planStatusLabel(student.eveningPlanStatus)} ·{' '}
          {student.addressVerification === 'PENDING' ? 'adres pin bekliyor' : 'adres doğrulandı'}
        </p>
      </section>
    </div>
  );
}
