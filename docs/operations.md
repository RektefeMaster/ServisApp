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

### Deploy (komut ÖNEMLİ)

`fly.toml` `apps/api/` altındadır ama `Dockerfile` repo kökünü kopyalar
(`pnpm-workspace.yaml`, `packages/`). `apps/api` içinden `fly deploy`
**başarısız olur** — derleme bağlamı repo kökü olmalıdır:

```bash
fly deploy -c apps/api/fly.toml --dockerfile apps/api/Dockerfile .
```

Deploy öncesi Fly secret'ları (eksikse `release_command` 1 ile çıkar):

| Secret                              | Neden                                                                |
| ----------------------------------- | -------------------------------------------------------------------- |
| `MIGRATION_DATABASE_URL`            | `release_command` migration uygular; doğrudan Postgres, pooler değil |
| `DATABASE_URL`                      | API isteği — transaction pooler (6543), `servisapp_api`              |
| `WORKER_DATABASE_URL`               | pg-boss LISTEN — session pooler (5432), `servisapp_worker`           |
| `SUPABASE_URL`                      | JWT issuer + JWKS keşfi                                              |
| `OTP_PEPPER`, `OTP_ENCRYPTION_KEY`  | Teslim kodu HMAC ve ciphertext                                       |
| `ADMIN_ORIGINS`, `ADMIN_PUBLIC_URL` | Panel CORS ve davet linki kökü                                       |
| `NETGSM_*`                          | SMS; boşsa kuyruk `QUEUED` kalır (sahte SENT yazılmaz)               |
| `SENTRY_DSN`                        | Kuyruk işleri hatayı buraya bildirir                                 |

`SUPABASE_JWT_SECRET` ve `DEV_LOGIN_PASSWORD` üretimde **boş bırakılır**.
Hosted proje ES256/JWKS kullanıyorsa HS256 secret uydurmak sahte jeton kabul
etmek demektir.

Worker HTTP almaz. Deploy sonrası `fly scale count worker=1` — sefer saatinde
kapanmasın. Fly `release_command` migration uygular (`MIGRATION_DATABASE_URL`
doğrudan Postgres); yeni imaj yayına alınmadan ÖNCE koşar, yani şema her zaman
koddan önce günceldir. Worker ayrıca `notify.outbox` ve `trips.lifecycle`
kuyruklarını işler: veli push (Expo), davet SMS ve teslim OTP SMS (Netgsm);
süresi dolmuş OTP `EXPIRED`; unutulan ACTIVE seferler grace sonrası
`AUTO_CLOSED`. Push token yoksa aynı metin SMS yedeği ile gider. `NETGSM_*`
boşsa SMS `QUEUED` kalır; sahte SENT / FAILED yazılmaz. 24 saatten eski
kuyruk `FAILED` olur. Durum bildirimleri 75 sn bekler; bu sürede geri alınan
işlem velinin telefonuna gitmez. Yaklaşma bildirimi `notifyAm` / `notifyPm`
tercihine uyar. Veli girişi üretimde Supabase telefon OTP'dir
(`EXPO_PUBLIC_DEV_LOGIN` kapalı).

pg-boss `LISTEN` için `WORKER_DATABASE_URL` session pooler (5432) kullanır;
transaction pooler (6543) kullanılmaz.

Yönetim paneli tarayıcıdan API'ye gider; `ADMIN_ORIGINS` CORS listesidir. Mobil
uygulamalar CORS kullanmaz.

## Supabase Auth — telefon iddiası (ZORUNLU kontrol)

Kimlik bağlama telefonla yapılır: `resolve_session` doğrulanmış numarayı JWT'nin
**üst seviye `phone`** iddiasından okur (SPEC §2). GoTrue bu alanı yalnız numara
doğrulandıktan sonra doldurur; doğrulanmamış değişiklik `phone_change`
kolonunda bekler ve jetona düşmez. `user_metadata` **okunmaz** — orası
`updateUser({ data })` ile kullanıcıya yazdırılabilir, yetki kararı olamaz.

Custom Access Token Hook üst seviyeye `phone_verified` koyuyorsa o bayrak
bağlayıcıdır: `false` ise telefon reddedilir. Hook yazacaksanız bunu bilerek
yapın — `false` basmak bütün girişleri kapatır.

Devreye alırken doğrulayın: yeni bir personel telefonuyla giriş yapıp
`select auth_user_id from identity where phone_e164 = '+90…'` dolmalı. Boşsa
jetonda telefon yok demektir ve hiçbir kimlik bağlanamaz.

## Vekil arkasında istemci IP'si

`CLIENT_IP_HEADER=fly-client-ip` `fly.toml` içinde tanımlıdır. Boş bırakılırsa
`request.ip` bütün istekler için Fly Proxy'nin adresidir; IP başına kurulmuş her
sınır (sahte jeton sayacı, `/v1/config`, davet önizlemesi) tek kovaya düşer ve
tek bir bozuk istemci sahadaki herkesi 429'a kilitleyebilir. Fly Proxy bu
başlığı kendisi yazar, istemciden geleni ezer — ama bu yalnız uygulama porta
SADECE vekil üzerinden erişilebildiği sürece doğrudur.

`TRUST_PROXY` (Fastify'ın kendi `request.ip`'si için) yalnız IP/CIDR kabul eder;
`true`, `1` ve hop-count bilerek reddedilir (CVE-2026-16732).

Hız sınırları süreç içi bellektedir: `min_machines_running = 2` ile etkin sınır
makine sayısıyla çarpılır ve makineler arasında paylaşılmaz. Kabul edilmiş bir
takastır; paylaşımlı sayaç gerekirse `@fastify/rate-limit` Redis deposu eklenir.

`platform_settings` (kill switch + minimum sürüm) API'de **5 saniye** önbelleğe
alınır: kapatma kararı en geç 5 saniyede sahaya yayılır.

## Hosted şema seviyesi (deploy öncesi ZORUNLU kontrol)

Hosted şema bir dönem MCP `apply_migration` ile elle basıldı. `pnpm db:migrate`
ve Fly `release_command` aynı defteri (`schema_migrations`) kullanır ve yalnız
defterde olmayan dosyaları uygular — ama defter elle basılan dosyaları
içermiyorsa 0001 yeniden `CREATE` etmeye kalkar ve deploy patlar.

Deploy öncesi defteri **migration bağlantısıyla** okuyun:

```bash
psql "$MIGRATION_DATABASE_URL" -c "select filename from schema_migrations order by 1"
```

Beklenen: `packages/db/migrations/` içindeki dosyaların kesintisiz bir ön eki.
Defter boşsa ya da elle basılan dosyalar eksikse, uygulanmış olanları
`insert into schema_migrations (filename) values (...) on conflict do nothing`
ile deftere yazın — SQL'i tekrar çalıştırmadan.

Uygulama tarafındaki kanıt (rol yetkisi gerektirmez): bir fonksiyon eksikse o
migration da eksiktir.

```sql
select to_regprocedure('public.update_trip_student_tracking_batch(jsonb,real,timestamptz)'); -- 0039
select to_regprocedure('public.issue_delivery_otp(uuid,bytea,bytea,timestamptz,boolean,integer)'); -- 0037
select to_regprocedure('public.resolve_session(uuid,text)'); -- 0038
```

Eksik migration ile deploy etmek sessiz bir arıza değildir: her GPS ping'i,
her teslim kodu ve outbox'ın tamamı 500 döner.

## Yayın günü sırası

1. Defteri doğrula (yukarıdaki bölüm).
2. Secret'ları yükle, `fly deploy` (release_command migration'ları uygular).
3. `fly scale count worker=1`.
4. `pnpm db:platform -- --min-app-version=1.0.0` — mağazadaki sürümle aynı
   semver. `0.0.0` kaldığı sürece sürüm kapısı hiçbir istemciyi tutmaz ve
   preview/internal derlemeler üretime konuşabilir.
5. `pnpm db:platform -- --dev-login=false` (varsayılan kapalı; teyit için).
6. `/health/ready` 200, `/v1/config` doğru `minSupportedAppVersion` dönüyor mu.

## Kill switch

`platform_settings`: `kill_gps`, `kill_otp`, `kill_realtime`,
`min_supported_app_version`, `dev_login_enabled`. `servisapp_api` bu satırı **UPDATE edemez** —
mağaza beklemeden kapatmak için migration bağlantısı gerekir.

```bash
pnpm db:platform -- --kill-gps=true
pnpm db:platform -- --kill-otp=true
pnpm db:platform -- --kill-realtime=true
pnpm db:platform -- --min-app-version=1.2.0
pnpm db:platform -- --dev-login=true     # YALNIZ yerel/saha provası
```

`dev_login_enabled` varsayılan **kapalıdır**. Geliştirme girişi fonksiyonları
(`find_dev_login_identity`, `find_dev_parent_identity`) şemada durur ama bayrak
kapalıyken `null` döner; `servisapp_api` bayrağı açamaz (bkz. 0041).

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
- [ ] [Hosted şema defteri](#hosted-şema-seviyesi-deploy-öncesi-zorunlu-kontrol) dosya listesiyle uyumlu
- [ ] `min_supported_app_version` mağazadaki semver (`0.0.0` değil)
- [ ] `dev_login_enabled = false`
- [ ] Kill switch üçlüsü ayrı ayrı açılıp kapanır
- [ ] Restore 1–5 maddesi
- [ ] KVKK metinleri hukukçu onayı (taslak canlıya çıkmaz)
- [ ] [Mağaza kontrol listesi](store-submission.md)
- [ ] [Saha provası](field-trial.md) 1 araç × 3 gün
