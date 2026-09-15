'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Preview {
  tenantName: string;
  phoneHint: string;
  status: string;
  message?: string;
}

export default function InviteLandingPage() {
  const params = useParams<{ token: string }>();
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    void fetch(`/api/invites/${encodeURIComponent(params.token)}`)
      .then(async (response) => {
        const body = (await response.json()) as Preview;
        setPreview(
          response.ok
            ? body
            : { tenantName: '', phoneHint: '', status: 'MISSING', message: body.message },
        );
      })
      .catch(() =>
        setPreview({
          tenantName: '',
          phoneHint: '',
          status: 'ERROR',
          message: 'Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.',
        }),
      );
  }, [params.token]);

  const inviteUrl =
    typeof window === 'undefined' ? '' : `${window.location.origin}/i/${params.token}`;

  if (!preview) return <p className="p-8 text-sm">Yükleniyor…</p>;

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <p className="font-serif text-3xl">ServisApp</p>
      {preview.status === 'ERROR' ? (
        <>
          <p className="mt-4 text-sm">{preview.message}</p>
          <button
            type="button"
            className="mt-4 border border-rule px-4 py-2 text-sm underline"
            onClick={() => {
              window.location.reload();
            }}
          >
            Tekrar dene
          </button>
        </>
      ) : preview.status === 'PENDING' ? (
        <>
          <p className="mt-4 text-sm">
            {preview.tenantName} sizi veli olarak davet etti. Bu link yetki değildir; telefon
            doğrulaması kimliğinizi kanıtlar.
          </p>
          <p className="mt-2 text-sm text-muted">Kayıtlı numara: {preview.phoneHint}</p>
          <a
            className="mt-6 inline-block border border-rule px-4 py-3 text-sm underline"
            href={`servisapp-parent://i/${params.token}`}
          >
            Veli uygulamasında aç
          </a>
          <p className="mt-4 text-sm">
            Uygulama açılmazsa önce mağazadan kurun, sonra uygulamada “Davet SMS’i aldım” deyip bu
            bağlantıyı yapıştırın. Telefon doğrulaması bittiğinde davet aktifleşir; davetten sonra
            eklenen çocuklar yeni SMS gerektirmez.
          </p>
          <p className="mt-4 break-all font-mono text-xs text-muted">{inviteUrl}</p>
        </>
      ) : (
        <p className="mt-4 text-sm">{preview.message ?? 'Bu davet artık kullanılamaz.'}</p>
      )}
    </main>
  );
}
