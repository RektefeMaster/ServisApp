'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';

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
    void fetch(apiUrl(`/v1/invites/${params.token}`))
      .then(async (response) => {
        const body = (await response.json()) as Preview;
        setPreview(
          response.ok
            ? body
            : { tenantName: '', phoneHint: '', status: 'MISSING', message: body.message },
        );
      })
      .catch(() => setPreview({ tenantName: '', phoneHint: '', status: 'MISSING', message: 'Okunamadı' }));
  }, [params.token]);

  if (!preview) return <p className="p-8 text-sm">Yükleniyor…</p>;

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <p className="font-serif text-3xl">ServisApp</p>
      {preview.status === 'PENDING' ? (
        <>
          <p className="mt-4 text-sm">
            {preview.tenantName} sizi veli olarak davet etti. Bu link yetki değildir; telefon
            doğrulaması kimliğinizi kanıtlar.
          </p>
          <p className="mt-2 text-sm text-muted">Kayıtlı numara: {preview.phoneHint}</p>
          <p className="mt-6 text-sm">
            Veli uygulamasını açın, bu numarayla OTP alın. Davetten sonra eklenen çocuklar yeni SMS
            gerektirmez.
          </p>
        </>
      ) : (
        <p className="mt-4 text-sm">{preview.message ?? 'Bu davet artık kullanılamaz.'}</p>
      )}
    </main>
  );
}
