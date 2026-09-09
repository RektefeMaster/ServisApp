# Operasyon el kitabı (Faz 9)

Kaynak: [SPEC.md](../SPEC.md) §12 ve Faz 9. Bu iskelet, yayın öncesi doldurulur.

## Süreçler

| Süreç  | Komut                 | Not                                    |
| ------ | --------------------- | -------------------------------------- |
| API    | `node dist/server.js` | Fly process `app`, HTTP :3000          |
| Worker | `node dist/worker.js` | Fly process `worker`, pg-boss `pgboss` |
| Admin  | Next.js (Vercel)      | Yalnız Auth JWT + Fastify              |
| Mobil  | EAS                   | `x-client` + `x-app-version` zorunlu   |

Worker HTTP almaz. Deploy sonrası `fly scale count worker=1` — sefer saatinde kapanmasın.

pg-boss `LISTEN` için `WORKER_DATABASE_URL` session pooler (5432) kullanır; transaction
pooler (6543) kullanılmaz.

Yönetim paneli tarayıcıdan API'ye gider; `ADMIN_ORIGINS` CORS listesidir. Mobil uygulamalar
CORS kullanmaz.

## Kill switch

`platform_settings`: `kill_gps`, `kill_otp`, `kill_realtime`. Mağaza sürümü beklemeden
kapanır. Restore provası (yedekten geri yükleme) Faz 9'da yazılıdır; yedeğin var olması
yeterli değildir.

## Partition bakımı

Kuyruk `maintenance.partition`, cron `15 3 1 * *` (UTC) ve süreç açılışında bir kez.
`ensure_month_partitions()` yalnız `servisapp_worker` çalıştırır.
