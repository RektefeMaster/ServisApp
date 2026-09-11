# Operasyon el kitabı

Kaynak: [SPEC.md](../SPEC.md) §12 ve Faz 9. Kill switch ve restore komutları
çalışır; mağaza gönderimi ve 3 günlük saha provası insan işidir.

## Süreçler

| Süreç  | Komut                 | Not                                    |
| ------ | --------------------- | -------------------------------------- |
| API    | `node dist/server.js` | Fly process `app`, HTTP :3000          |
| Worker | `node dist/worker.js` | Fly process `worker`, pg-boss `pgboss` |
| Admin  | Next.js (Vercel)      | Yalnız Auth JWT + Fastify              |
| Mobil  | EAS                   | `x-client` + `x-app-version` zorunlu   |

Worker HTTP almaz. Deploy sonrası `fly scale count worker=1` — sefer saatinde
kapanmasın.

pg-boss `LISTEN` için `WORKER_DATABASE_URL` session pooler (5432) kullanır;
transaction pooler (6543) kullanılmaz.

Yönetim paneli tarayıcıdan API'ye gider; `ADMIN_ORIGINS` CORS listesidir. Mobil
uygulamalar CORS kullanmaz.

## Kill switch

`platform_settings`: `kill_gps`, `kill_otp`, `kill_realtime`,
`min_supported_app_version`. `servisapp_api` bu satırı **UPDATE edemez** —
mağaza beklemeden kapatmak için migration bağlantısı gerekir.

```bash
pnpm db:platform -- --kill-gps=true
pnpm db:platform -- --kill-otp=true
pnpm db:platform -- --kill-realtime=true
pnpm db:platform -- --min-app-version=1.2.0
```

Üretimde `MIGRATION_DATABASE_URL` doğrudan Postgres'tir (pooler değil). GPS
kapanınca personel ping'i `GPS_KILLED` alır; sefer durmaz. OTP kapanınca yeni
kod üretilmez. Realtime kapanınca veli 12 sn polling'e düşer.

Eski APK: `min_supported_app_version` üstündeki istemci `426 Upgrade Required`
alır. `x-client` olmadan 426 atlanamaz.

## Restore provası

Yedeğin var olması ile geri yükleyebilmek aynı şey değildir. Prova, yedeği **yeni
bir veritabanına** yükleyip uygulamanın o kopyaya bağlanmasıdır.

Yerel (Docker Postgres 17):

```bash
pg_dump -U postgres --no-owner -f /tmp/servisapp.dump.sql servisapp
psql -U postgres -c 'DROP DATABASE IF EXISTS restore_target WITH (FORCE);'
psql -U postgres -c 'CREATE DATABASE restore_target;'
psql -U postgres -d restore_target -v ON_ERROR_STOP=1 -f /tmp/servisapp.dump.sql
grant connect on database restore_target to servisapp_api;
```

Hosted (Supabase): dashboard yedeğini ayrı bir projeye restore et; roller
`servisapp_api` / `servisapp_worker` şema dump'ında yoktur, cluster'da
`pnpm db:bootstrap-roles` ile oluşturulur. ACL'li dump için roller **önce**
var olmalıdır.

Prova bitti sayılır ancak:

1. Restore edilen kopyada `trip` satırı durur.
2. `servisapp_api` `event` UPDATE edemez.
3. Üstünde `ON_BOARD` öğrenci varken `complete_trip` reddeder.
4. API `DATABASE_URL`'i bu kopyaya çevrilip `/health/ready` 200 döner.
5. Personel uygulaması o API'ye bağlanıp bir seferi `READY` → `ACTIVE` yapar.

Otomatik kısım: `packages/db/src/restore.test.ts` (1–3). 4–5 yayın öncesi
elle.

## Partition bakımı

Kuyruk `maintenance.partition`, cron `15 3 1 * *` (UTC) ve süreç açılışında bir
kez. `ensure_month_partitions()` yalnız `servisapp_worker` çalıştırır.

## Yük koşusu

```bash
pnpm --filter @servisapp/domain build
pnpm --filter @servisapp/simulator start -- --vehicles=100 --scenario=all
```

Çıkış 0 olmalı. Raporda `realtime_messages` GPS kabulünü veli sayısıyla
çarpmaz; `calls_per_trip` ortalaması 0.5 altında kalmalıdır. 100 araçlık koşu
domain motorudur; canlı API'ye 100 sefer basmak saha/yük penceresinde ayrıca
yapılır.

## Gözlemlenebilirlik

Log alanları: `request_id`, `command_id`, `trip_id`, `tenant_id`. Sentry DSN ve
OTel uç noktası env'de boşsa süreç ayağa kalkar, dışarıya göndermez. Bir velinin
"servis gelmedi" iddiası: `event` + `trip_student` + `vehicle_current_location`
aynı `trip_id` ile.

## Yayın öncesi kapı

- [ ] `pnpm test` yeşil (domain, db invariant, restore, simulator, Kadıköy e2e)
- [ ] Kill switch üçlüsü ayrı ayrı açılıp kapanır
- [ ] Restore 1–5 maddesi
- [ ] KVKK metinleri hukukçu onayı (taslak canlıya çıkmaz)
- [ ] [Mağaza kontrol listesi](store-submission.md)
- [ ] [Saha provası](field-trial.md) 1 araç × 3 gün
