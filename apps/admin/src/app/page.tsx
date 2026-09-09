import { API_BASE_URL } from '@/lib/api';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold">ServisApp Yönetim</h1>
      <p className="text-slate-400">
        Altyapı hazır. Kurulum ve rota API&apos;si çalışıyor; panel ekranları sıradaki iş.
      </p>
      <p className="font-mono text-sm text-sky-400">{API_BASE_URL}</p>
    </main>
  );
}
