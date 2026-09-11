# ServisApp V1 — Implementation Spec (rev. 3.3)

## Context

Servis şirketinin sabah/akşam öğrenci taşıma operasyonu bugün Excel + WhatsApp + telefon + ezberle yürüyor. ServisApp bunu tek sisteme taşıyacak: **sabit rota + günlük istisna motoru + canlı sefer + öğrenci durum takibi + güvenli farklı teslimat + sağlam olay kaydı.** Navigasyon motoru veya okul ERP'si yazmıyoruz.

Bu ilk ciddi satış. Plan iki şeyi aynı anda tutuyor: **V1 kapsamı dar** (satışı kapatan çekirdek), **çekirdeğin altyapısı sağlam** (durum makinesi, idempotency, olay kaydı, kiracı izolasyonu). Ölçek hedefi 4.000 öğrenci; mimari 40.000'de değişmeyecek, mikroservise gerek yok. Repo şu an boş (`.git` var, tek commit yok).

**rev. 3.3 özellikleri şişirmez; kayıt, davet ve erişim sözleşmesini kilitler.** Bundan sonraki en değerli iş spec büyütmek değil, bu sözleşmeyi uygulamaktır.

### Düzeltme geçmişi (özet)

**rev. 2:** Android arka plan konumunda "asla gerekmez" iddiası kaldırıldı · çapraz tablo CHECK imkânsızlığı · `client_event_id` yalnız replay çözer · domain paketi mobilde yetki kaynağı değil · Route Matrix element başına faturalanıyor · V1 kapsamı daraltıldı.
**rev. 3:** Periyodik Routes çağrısı tamamen kaldırıldı → event-driven · konum ile ETA kesin ayrıldı · smooth marker interpolation · GPS kalite filtresi + `eta_confidence` + `route_segment_stat` · maliyet hedefi doğruluk pahasına elde edilmeyecek.
**rev. 3.1:** `otp_hmac` + `otp_ciphertext` ayrımı · baseline chunking · `command_receipt` · tenant_id + bileşik FK standardı · broadcast veli sayısıyla çarpılmıyor · Expo SDK 57 / RN 0.86.3.
**rev. 3.3:** Yönetici kaydı / veli aktivasyonu / `student_guardian` erişimi kilidi. Özellik yığını değil.

### rev. 3.2 — zorunlu düzeltmeler

| #   | Kritik                                          | Ne değişti                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Rota snapshot gerçek snapshot değildi**       | `trip_stop` yalnız `stop_id` tutuyordu; durağın koordinatı sonradan değişirse dünkü sefer de değişirdi. Artık `snapshot_lat/lng/label/address_text` + `source_stop_id` (yalnız köken bilgisi). **Kural: sefer başladıktan sonra `route`/`stop`/`address` tablolarına bakmadan tamamlanabilmeli** |
| 2   | **OTP doğrulamasında mimari çelişki**           | Pepper Fly secret'ta ama doğrulamayı Postgres fonksiyonu yapıyordu — Postgres o secret'ı bilmez. Kripto **Fastify'a** alındı; DB yalnız kilitleme + atomik state geçişi (`mark_delivery_verified`) yapıyor                                                                                       |
| 3   | **RLS "ikinci bariyer" garanti değildi**        | Supabase `service_role` RLS'i bypass eder. Üç ayrı DB rolü tanımlandı (`servisapp_api` / `servisapp_worker` / `servisapp_migration`), API rolünde BYPASSRLS yok, istek başına `SET LOCAL app.tenant_id`                                                                                          |
| 4   | **`command_receipt` şeması akışla uyuşmuyordu** | `PENDING` durumu enum'da yoktu, migration patlardı. Eklendi                                                                                                                                                                                                                                      |
| 5   | **`complete_trip` olmayan kolona bakıyordu**    | `resolution IS NULL` diye bir kolon yok; çözülmemiş hâl zaten `DELIVERY_FAILED` state'inin kendisi. Predicate sadeleşti                                                                                                                                                                          |
| 6   | **reconcile operasyon state'ini ezebiliyordu**  | Reconcile artık yalnız **plan** katmanını üretir; fiziksel gerçeklik oluşmuş state'ler (`ON_BOARD`, `DELIVERED`, …) değiştirilemez. Precedence tablosu eklendi                                                                                                                                   |
| 7   | **Kimlik ile tenant üyeliği karışmıştı**        | Aynı telefon iki şirkette veli, birinde şoför olabilir. `identity` → `tenant_membership` → `membership_role` ayrıldı                                                                                                                                                                             |

| #   | Önemli                                                                                                                                                                                                     | Ne değişti |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 8   | Realtime aboneliği teslimde kendiliğinden kesilmiyor (policy bağlantı başında değerlendirilip cache'leniyor) → `TRIP_TRACKING_ENDED` event + client unsubscribe + sunucu viewer registry + polling ucu 410 |
| 9   | Interpolation tanımı netleştirildi: **istemci animasyonu yeni konum verisi değildir**, backend'e geri yazılmaz                                                                                             |
| 10  | Baseline chunking'de her parçaya `departureTime = now` verilemez → **sequential assembly** (chunk N'in kalkışı = chunk N-1'in tahmini varışı)                                                              |
| 11  | Maliyet metninde "hepsi Essentials" ifadesi yanlış — waypoint sayısı/optimization SKU'yu Pro'ya çıkarabilir. Hedef **hem 10k Essentials hem 5k Pro** bandının altında                                      |
| 12  | ComputeRouteMatrix istek başına **max 625 element** → batch planner + concurrency limit                                                                                                                    |
| 13  | Sparse matrix + 2-opt birlikte eksik graf üretir → **lazy edge materialization** (cache hit → gerçek, miss → haversine, yüksek potansiyelli swap → on-demand fill)                                         |
| 14  | `device_seq` katı sıra şartı kuyruğu sonsuza kilitleyebilir → sıra yalnız **batch içi**; correctness her zaman CAS                                                                                         |
| 15  | Undo tombstone'unu saklayacak tablo yoktu → `pending_command_dependency` + `expires_at`                                                                                                                    |
| 16  | Araç konumunun hangi cihazdan geldiği belirsizdi (iki telefon = zıplayan marker) → `location_source_device_id` + `location_session_epoch`                                                                  |

### rev. 3.3 — kayıt, davet, erişim (kilit)

Bu revizyon yeni ürün katmanı eklemez. Admin veriyi kurar, rota operasyonu belirler, veli yalnız aktive olur, günlük değişiklik exception motorundan geçer. Identity sökülmez; öğrenci araca değil rotaya yazılır; davet linki yetki değil onboarding başlangıcıdır.

**Erişim (tek cümle, server-side zorunlu):** `tenant_membership ACTIVE` yalnız tenant erişimi sağlar; bir öğrencinin okunabilmesi için aynı tenant altında aktif `student_guardian` ilişkisi zorunludur. UI gizlemesi güvenlik değildir. `auth_user_id` bağlama personel/yönetici için telefon (JWT `phone`) iledir; veli yalnız davet aktivasyonunda bağlanır; doğrulanmış e-posta tek başına kimliği ele geçirmez.

Personel uygulaması bu sözleşmenin parçası değildir. Şoför/hostes e-posta + `GET /v1/session` + `trip_crew_assignment` ile girer; SMS/davet/Universal Link crew'da yoktur ve V1'de eklenmez.

| #   | Kilit | Sözleşme |
| --- | ----- | -------- |
| 17  | Üyelik ≠ çocuk | Çocuk listesi yalnız `student_guardian.status = ACTIVE` + `tenant_membership ACTIVE`. `resolve_session` yalnız personel/yönetici (ADMIN/DRIVER/ATTENDANT) telefonla bağlar ve INVITED→ACTIVE eder; GUARDIAN-only üyelik davet aktivasyonuna kadar INVITED ve `auth_user_id` boş kalır |
| 18  | Import staging domain değil | `import_batch` / `import_batch_row` operasyon kaydıdır. Commit edilmemiş Excel `student`/`identity`/`trip` yazmaz. Satır satır `COMMITTED`/`FAILED`; giant transaction yok. `importBatchId` (+ dosya hash) idempotent |
| 19  | Telefon kişi anahtarı değil | Normalize telefon eşleşme sinyalidir. Otomatik merge yok. Aynı isim+telefon+ikinci çocuk: bilinçli reuse, yeni davet yok. `identity.phone_e164 UNIQUE` Auth lookup içindir, merge lisansı değildir; V1'de düşürülmez |
| 20  | Davet kişi/üyelik | `guardian_invite` bağlanır: `tenant_id + identity_id + tenant_membership_id`. `studentId` taşımaz. Aktivasyondan sonra çocuklar aktif `student_guardian`'dan okunur |
| 21  | Davet ≠ SMS teslim | Invite: `PENDING → USED \| EXPIRED \| REVOKED`. SMS: `QUEUED → SENT → DELIVERED \| FAILED` |
| 22  | Segment plan durumu | Veli API `morningPlanStatus` / `eveningPlanStatus`: `PREPARING \| READY \| NO_SERVICE \| SUSPENDED`. UI tahmin etmez. Davet SMS'i rota yayınından bağımsızdır |
| 23  | Yayın ≠ sefer READY | Yayın: boş olmayan rota, aktif öğrenci stop'u, stop koordinatı, geçerli okul/adres, doğru segment. Araç/şoför/hostes eksiği yayını değil sefer `READY` geçişini bloklar |

**Lifecycle (karıştırılmaz):**

```
Student          ACTIVE → ENDED          (enrollment_end NULL = ACTIVE)
StudentGuardian  ACTIVE → REVOKED        (unique çift kalır; yeniden bağlama aynı satır)
Membership       INVITED → ACTIVE → SUSPENDED | REVOKED
Invite           PENDING → USED | EXPIRED | REVOKED
SMS              QUEUED → SENT → DELIVERED | FAILED
```

Normal durumlar: üyelik ACTIVE + davet USED; üyelik açık + çocuk ilişkisi REVOKED; davet PENDING + SMS FAILED.

Aktive olmuş (`auth_user_id` dolu) telefonda kör `identity.phone` güncellemesi yok; V1'de yalnız admin destek akışı.

**Ayrıca eklenenler (ucuzken):** minimum desteklenen app sürümü (`426 Upgrade Required`) · sunucu tarafı feature flag'ler · GPS/OTP/realtime için ayrı kill switch · **restore testi** (yedeğin var olması ile geri yükleyebilmek aynı şey değil) · structured log + Sentry/OTel (`request_id` + `command_id` + `trip_id` + `tenant_id`).

### Onaylanan kararlar

| Karar            | Seçim                                            |
| ---------------- | ------------------------------------------------ |
| Mobil app sayısı | **2 ayrı app** (Veli + Personel), tek monorepo   |
| Repo konumu      | `~/Developer/ServisApp` (iCloud dışı)            |
| Veri katmanı     | **Supabase** (Postgres + Auth + Storage)         |
| İş mantığı       | **Fastify API** → Fly.io Frankfurt               |
| Kuyruk/cron      | **pg-boss** (Postgres üstünde) — Redis yok       |
| Çok müşterili    | Baştan tenant'lı                                 |
| Arka plan konum  | expo-location + watchdog, **soyutlanmış katman** |
| Tempo            | Kalite öncelikli                                 |

---

## 1. V1 kapsamı — kesin çizgi

### Pazarlıksız V1

1. **Rota snapshot** — sefer üretildiği anda durakları koordinatlarıyla birlikte kopyalar.
2. **Sefer + öğrenci durum makinesi** — tek makine, `delivery_target` ayrımıyla.
3. **Offline outbox + CAS** — cihazda kuyruk, sunucuda compare-and-set.
4. **Olay kaydı** — append-only, UPDATE/DELETE yetkisi yok.
5. **Araçta öğrenci varken sefer kapatılamaz** — kilitli transaction + trigger backstop.
6. **Farklı adreste server-side OTP** — kod, hash'i ve ciphertext'i personel cihazına hiç gitmez.

### V1'e giren diğerleri

Kurulum ekranları (okul/araç/personel/öğrenci/veli + adres pin doğrulama) · rota oluşturma + sürükle-bırak + versiyonlama · sefer üretimi · personel sefer ekranı · sefer öncesi/sonrası **araç boş** kontrolü · canlı konum + "yaklaşıyor" bildirimi · veli ana ekran + canlı harita + bildirimler · "bugün kullanmayacak" · kritik değişiklik uyarı+onay · sefer bazlı araç/şoför/hostes değişimi + öğrenci transferi + kapasite · yönetici canlı harita + öncelikli olaylar · olay kayıtları · sorun bildir.

### V1.1'e ertelenen (şemada yer bırakılıyor, kod yazılmıyor)

| Erteleme                                        | V1'deki basit karşılığı                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Tam okul takvimi (yarım gün, ara tatil, bayram) | "Servis yapılmayan günler" listesi; tablo var, yalnız `HOLIDAY` kullanılıyor       |
| Polygon servis alanı editörü                    | `route.max_detour_m` — sayı alanı, harita çizimi yok                               |
| Otomatik `AUTO_CLOSED`                          | "Hâlâ açık sefer" alarmı + elle kapatma. Durum enum'da                             |
| Detaylı `SUSPENDED`/`ABORTED` yönetimi          | Enum'da var; V1'de "seferi durdur/iptal et" + öğrenci başına elle akıbet           |
| 60 günlük tam GPS geçmişi                       | 14 gün, örneklenmiş (30 sn). Uyuşmazlık delili zaten event log'daki varış olayları |
| Günlük takip defteri PDF                        | Ekranda liste + CSV                                                                |
| İki veli çakışma motoru                         | `can_authorize_temp_address` + tüm velilere bildirim                               |
| Alternate receiver varyasyonları                | Tek yol: `DELIVERY_FAILED` → yönetici karar verir                                  |

---

## 2. Araştırmadan çıkan, tasarımı belirleyen bulgular

1. **Mevzuat lehimize.** Okul Servis Araçları Yönetmeliği rehber personeli okul öncesi/ilkokul/kreşte zorunlu kılıyor ve **taşıma öncesi ve sonrası araç içi kontrolünü** şart koşuyor. V1'deki "araç boş kontrolü" hem en ağır kazayı engelliyor hem satış argümanı.
2. **OTP personel cihazına asla gitmez — hash'i bile.** 6 hanelik kodun hash'i rootlu telefonda milisaniyede kırılır; kural yapısal olarak çöker.
3. **Canlı takip ile Google Routes tamamen ayrı işlerdir.** Konum telefonun gerçek GPS'inden, Google yalnız ETA/rota referansı. Veli ekranında saniyede yüzlerce hareket olsa bile Google çağrı sayısı değişmez.
4. **Route Matrix element başına faturalanır** ve istek başına **max 625 element** kabul eder. 60 durak = 3.600 element = zorunlu batch'leme.
5. **ComputeRoutes max 25 ara durak**, 11+ durak daha pahalı SKU. Bu yüzden ≤25'te doğrudan optimizasyon, üstünde cache'li matrix + 2-opt.
6. **Android FGS avantajı gerçek ama koşullu.** Uygulama görünürken başlatılan `location` tipli FGS arka planda konum akıtır; ama servis **arka plandan yeniden başlatılacaksa** `ACCESS_BACKGROUND_LOCATION` yeniden gündeme gelir. Mimari bu varsayıma kilitlenmiyor.
7. **İkili eğitim gerçeği.** Aynı araç günde 4 sefer, bir araç iki okul. `shift_no` + `school_id` şimdi 1 kolon, sonra veri modelini yeniden yazmak.
8. **Veli haritası diğer ailelerin adreslerini sızdırabilir.** Durak sırası + bekleme süreleri izlenirse mahalle haritası çıkar.

---

## 3. Mimari

```
┌── apps/parent (Expo)  ─┐                    ┌─────────────────────┐
├── apps/crew   (Expo)  ─┼── HTTPS/REST ────► │  apps/api (Fastify) │
└── apps/admin  (Next)  ─┘                    │  Fly.io / Frankfurt │
         │                                     └──────┬──────────────┘
         │  Supabase Auth (JWT)                       │ Drizzle
         │  Kısılmış canlı yayın ◄────────────────────┤ pg-boss (cron+kuyruk)
         │  Storage (imzalı URL)                      ▼
         └───────────────────────────► ┌──────────────────────────────┐
                                       │ Supabase Postgres (+RLS)     │
                                       └──────────────────────────────┘
                         Google Maps Platform · Netgsm OTP SMS
```

**Sorumluluk sınırı:** İstemciler veriyi Supabase'den doğrudan okumaz/yazmaz — **tüm okuma/yazma API'den geçer.** Supabase'den doğrudan kullanılan üç şey: Auth (JWT), canlı yayın kanalı, Storage (imzalı URL).

**Neden ayrı API:** Supabase Edge Functions istek başına **2 saniye CPU** ile sınırlı ve Deno tabanlı; rota hesabı, ETA motoru, toplu bildirim ve offline kuyruk işleme buraya sığmaz.

**`packages/domain` sözleşmesi:** Saf kurallar (geçiş matrisi, reconcile, kapasite, ETA) burada yaşar, hem sunucuda hem mobilde çalışır. **Mobil taraf asla yetki kaynağı değildir** — orada çalışması yalnız UX içindir. Gerçek karar Fastify + DB transaction'ında verilir; sunucu istemcinin gönderdiği duruma değil, yalnız **niyete** bakar ve durumu kendisi hesaplar.

### DB rolleri ve RLS modeli (kritik)

Supabase'in `service_role` anahtarı **RLS'i bypass eder**. API bununla bağlanırsa "RLS ikinci bariyerdir" cümlesi doğru olmaz. Bu yüzden üç ayrı rol:

| Rol                   | Kullanım           | Yetki                                                                                          |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `servisapp_api`       | Fastify istek yolu | **BYPASSRLS yok.** Yalnız gereken tablolara grant. `trip_student` üzerinde doğrudan UPDATE yok |
| `servisapp_worker`    | pg-boss job'ları   | Aynı kısıtlar; **tenant context zorunlu** — job payload'ı tenant'ı taşır                       |
| `servisapp_migration` | Migration/deploy   | Güçlü, ama runtime'da asla kullanılmaz                                                         |

Her istek/iş başında:

```sql
SET LOCAL app.tenant_id = '...';
SET LOCAL app.user_id   = '...';
SET LOCAL app.role      = '...';
```

RLS politikaları `tenant_id = current_setting('app.tenant_id')::uuid` üzerinden çalışır. Böylece API'de unutulan bir tenant filtresi DB'de yakalanır.

### Bağlantı stratejisi

Transaction pooler arkasında session seviyesi davranışlar farklıdır; bu yüzden bağlantı türleri baştan ayrılıyor:

| Tüketici                                  | Bağlantı                                                            |
| ----------------------------------------- | ------------------------------------------------------------------- |
| API istek yolu                            | Havuz (transaction pooler) — `SET LOCAL` transaction içinde güvenli |
| pg-boss                                   | Ayrı, kendine ait havuz                                             |
| `LISTEN/NOTIFY` (kendi WS'imize geçersek) | Kalıcı **session** bağlantısı — pooler arkasında değil              |
| Migration                                 | Doğrudan/admin bağlantı                                             |

### Teknoloji

| Katman      | Seçim                                                   | Gerekçe                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo    | pnpm workspaces + Turborepo                             | Tek `pnpm dev`, paylaşılan tipler                                                                                                                                                            |
| API         | Fastify + TypeScript + zod                              | Hafif, dekoratör şişkinliği yok                                                                                                                                                              |
| ORM         | **Drizzle**                                             | Üretilen SQL okunabilir ve elle düzenlenebilir; belkemiğimiz DB kısıtları, trigger'lar ve fonksiyonlar                                                                                       |
| Kuyruk/cron | **pg-boss**                                             | Redis'e gerek yok                                                                                                                                                                            |
| Mobil       | **Expo SDK 57 / RN 0.86.3 — `expo@57.0.17`+ pinlenmiş** | SDK 56 ve ilk SDK 57 sürümlerindeki Hermes V1 memory regression'ı Reanimated ile Android belleğini ~%25-30 şişiriyor; sürekli harita + marker animasyonu yapan bir uygulamada kabul edilemez |
| Harita      | **react-native-maps**                                   | Google Maps'i iOS'ta da render eden tek olgun seçenek                                                                                                                                        |
| Offline     | expo-sqlite (outbox) + TanStack Query                   |                                                                                                                                                                                              |
| Admin       | Next.js + Tailwind + shadcn/ui                          |                                                                                                                                                                                              |
| Push / SMS  | Expo Push (600/sn) / Netgsm OTP SMS                     | OTP ticari ileti değil, İYS izni gerekmez                                                                                                                                                    |

### Repo iskeleti

```
ServisApp/
├── apps/
│   ├── api/         modül başına: routes.ts · service.ts · repo.ts
│   ├── admin/       Next.js yönetici paneli
│   ├── parent/      Expo — veli
│   ├── crew/        Expo — şoför + hostes
│   └── simulator/   yük & saha senaryosu simülatörü
├── packages/
│   ├── domain/      saf kurallar (sunucu: yetki · mobil: UX)
│   ├── contracts/   zod şemaları = API sözleşmesi
│   ├── db/          Drizzle şema + migration + SQL fonksiyonlar + RLS + roller + seed
│   ├── ui/          paylaşılan RN bileşenleri + tema
│   └── config/      ortak tsconfig/eslint
└── docs/            domain-model.md · kvkk/ · operasyon el kitabı
```

---

## 4. Veri modeli

Üç katman ayrı. **Günlük katman kalıcı katmanı asla değiştirmez.**

### Tenant standardı (istisnasız)

Her operasyonel tabloda doğrudan `tenant_id` bulunur — join üzerinden türetilebilecek olsa bile — ve mümkün olan her ilişkide **bileşik foreign key** kullanılır:

```sql
FOREIGN KEY (tenant_id, trip_id)    REFERENCES trip(tenant_id, id)
FOREIGN KEY (tenant_id, student_id) REFERENCES student(tenant_id, id)
```

Bir tenant'ın `student_id`'sini başka tenant'ın `trip`'ine bağlamak böylece **DB seviyesinde imkânsız** olur. Aşağıda yer kazanmak için tekrarlanmasa da tüm operasyon tablolarında `tenant_id` vardır.

### Kimlik — global kimlik ≠ tenant üyeliği

Aynı telefon iki farklı servis şirketinde veli olabilir; aynı kişi bir şirkette şoför, diğerinde veli olabilir. Supabase Auth kimliği global, üyelik ise tenant'a aittir:

```
identity(id, auth_user_id UNIQUE, phone_e164, email, full_name)   -- global
tenant_membership(id, tenant_id, identity_id, status)  UNIQUE(tenant_id, identity_id)
membership_role(membership_id, role[ADMIN|DRIVER|ATTENDANT|GUARDIAN], scope_id)
device(id, membership_id, platform, push_token, app_version, last_sync_at, revoked_at)
```

```
Supabase auth.users → identity → tenant_membership → membership_role
```

Diğer tüm tablolar kullanıcıya `membership_id` ile bağlanır (`student_guardian.guardian_membership_id`, `trip_crew_assignment.membership_id`, …). Bunu sonradan eklemek can sıkıcı bir migration; şimdi bedava.

`identity.phone_e164` Auth/OTP lookup için UNIQUE kalır; bu otomatik kişi birleştirme lisansı değildir. Tenant veya `student_guardian` üzerine telefon UNIQUE eklenmez.

### Kalıcı

```
tenant(id, name, timezone='Europe/Istanbul', settings jsonb)

school(id, tenant_id, name, level, address_id, attendant_required)
vehicle(id, tenant_id, plate, seat_count, model_year, inspection_expiry, insurance_expiry)
staff_assignment(vehicle_id, membership_id, role, valid_from, valid_to)

address(id, tenant_id, text, il, ilce, lat, lng, geocode_confidence, verified_at) -- APPEND-ONLY
stop(id, tenant_id, address_id, lat, lng, label)    -- aracın durduğu nokta ≠ kapı

student(id, tenant_id, school_id, full_name, grade, photo_path,
        handover_policy[GUARDIAN_REQUIRED|MAY_LEAVE_ALONE], enrollment_start, enrollment_end)
student_guardian(student_id, guardian_membership_id, relation, is_primary,
        status[ACTIVE|REVOKED],
        can_receive_child, can_authorize_temp_address, can_submit_exception,
        notify_am, notify_pm)
student_address(student_id, address_id, usage[PICKUP|DROPOFF], valid_from, valid_to)
student.uses_morning / uses_evening  -- bilinçli NO_SERVICE; Excel metni koordinat değildir

import_batch(id, tenant_id, file_hash, file_name, created_by_membership_id)
import_batch_row(batch_id, row_no, raw jsonb, status[PENDING|READY|NEEDS_FIX|ADDRESS_UNVERIFIED|COMMITTED|FAILED],
        error_code, student_id, identity_id)  -- domain tablosu değil
guardian_invite(tenant_id, identity_id, membership_id, token_hash,
        status[PENDING|USED|EXPIRED|REVOKED], expires_at)  -- student_id YOK
invite_sms(invite_id, status[QUEUED|SENT|DELIVERED|FAILED], provider)

route(id, tenant_id, vehicle_id, school_id, segment[MORNING|AFTERNOON], shift_no, max_detour_m)
  UNIQUE(tenant_id, vehicle_id, segment, shift_no)             -- ikili eğitim
route_version(id, route_id, version_no, status[DRAFT|PUBLISHED|ARCHIVED], effective_from)
route_stop(route_version_id, stop_id, seq, kind[PICKUP|DROPOFF|SCHOOL])
  UNIQUE(route_version_id, seq)
route_stop_student(route_stop_id, student_id)

school_calendar_day(tenant_id, school_id, date, type, pm_departure_override) -- V1: yalnız HOLIDAY
stop_travel_time_cache(from_stop_id, to_stop_id, seconds, meters, computed_at)
route_segment_stat(route_id, from_stop_id, to_stop_id, weekday, time_bucket,
     sample_count, avg_seconds, median_seconds, p75_seconds, updated_at)
```

### Günlük operasyon — sefer kendi kopyasını taşır

```
trip(id, tenant_id, route_id, route_version_id, service_date DATE, segment, state,
     planned_departure_at, actual_started_at, actual_completed_at,
     current_vehicle_id, current_driver_membership_id, current_attendant_membership_id,
     cancel_reason,
     location_source_device_id, location_session_epoch,   -- canlı konumu KİM gönderiyor
     route_baseline jsonb, baseline_computed_at, routes_calls_count, last_routes_call_at)
  UNIQUE(tenant_id, route_id, service_date)               -- çift üretim imkânsız

trip_stop(id, tenant_id, trip_id, seq NUMERIC, kind,
     source_stop_id,                    -- YALNIZ köken/provenance
     snapshot_lat, snapshot_lng,        -- OPERASYONDA KULLANILAN koordinat
     snapshot_label, snapshot_address_text,
     planned_eta, actual_arrived_at)
trip_stop_student(trip_stop_id, student_id)

trip_student(id, tenant_id, trip_id, student_id, state, state_seq INT, state_changed_at,
     delivery_target[SCHOOL|HOME|TEMP],
     expected_stop_id, actual_stop_id,
     snapshot_dropoff_lat, snapshot_dropoff_lng, snapshot_dropoff_text,  -- teslim noktası kopyası
     boarded_at, boarded_lat/lng, origin, counterpart_trip_student_id, needs_review,
     delivery_method[HOME_NO_CODE|OTP|ADMIN_OVERRIDE], delivery_verified_at,
     delivery_override_id, receiver_name,
     eta_seconds, eta_confidence, eta_computed_at, approach_notified_at)

trip_vehicle_assignment(trip_id, vehicle_id, valid_from, valid_to, reason)
trip_crew_assignment(trip_id, membership_id, role, valid_from, valid_to, reason)
```

> **Snapshot kuralı:** Sefer `ACTIVE` olduktan sonra `route`, `route_stop`, `stop` ve `address` tablolarına **hiç bakılmadan** tamamlanabilmelidir. Yönetici bugün durağın koordinatını, adresini veya adını değiştirse bile dünkü sefer operasyonel olarak birebir aynı kalır. Bu, §13'teki en önemli invariant testidir.

```
-- İstisnalar: MUTASYON DEĞİL, GİRDİ. Append-only.
ride_exception(id, tenant_id, student_id, service_date, segment, created_by_membership_id,
     source, cancelled_at)
delivery_override(id, tenant_id, student_id, service_date, address_id, receiver_name,
     receiver_phone, otp_hmac, otp_ciphertext, otp_expires_at, attempt_count,
     locked_until, resend_count, verified_at, verified_by, status)
     -- otp_hmac      : doğrulama (pepper ile, geri çözülemez)
     -- otp_ciphertext: YALNIZ yeniden SMS gönderimi; anahtar Fly secret/KMS'te,
     --                 doğrulama/iptal/expire sonrası temizlenir
student_trip_move(student_id, service_date, segment, target_route_id, reason)
address_change_request(student_id, proposed_address_id, status, effective_from_date)

vehicle_current_location(vehicle_id, trip_id, lat, lng, speed, heading, accuracy_m,
     recorded_at, received_at, source_device_id, session_epoch,
     quality[GOOD|LOW|REJECTED], is_stale)
vehicle_location_ping(...)                    -- aylık partition, 14 gün, örneklenmiş

critical_change_alert(id, trip_id, severity, body, requires_ack_roles)
critical_change_ack(alert_id, membership_id, device_id, acked_at)
trip_vehicle_check(trip_id, phase[BEFORE|AFTER], checked_by, vehicle_empty_confirmed, at)
notification(recipient_membership_id, channel, type, trip_id, student_id,
     status, sent_at, dedupe_key)
```

### Olay kaydı ve idempotency — ayrı iki mekanizma

```
-- "Gerçekte ne oldu" — append-only denetim izi
event(seq BIGSERIAL, tenant_id, occurred_at_server, occurred_at_device,
      actor_membership_id, actor_role, device_id, vehicle_id, trip_id,
      subject_type, subject_id, event_type, prev_state, new_state, lat, lng,
      payload jsonb, source_command_id, is_undo_of_event_id, app_version, late_arrival)
  REVOKE UPDATE, DELETE          -- uygulama bu tabloyu yeniden yazamaz
  aylık partition

-- "Bu komutu daha önce işledim mi" — teknik idempotency makbuzu
command_receipt(tenant_id, client_event_id UUID, device_id, device_seq, command_type,
      status[PENDING|APPLIED|CONFLICT|REJECTED], response_json, created_at)
  UNIQUE(tenant_id, client_event_id)

-- Hedefi henüz gelmemiş komutlar (ör. geri alma, işleminden önce ulaştı)
pending_command_dependency(tenant_id, client_event_id, target_client_event_id,
      command_type, payload jsonb, expires_at)
```

**Neden ayrı:** Idempotency anahtarı event tablosunda olsaydı, CAS başarısız olduğunda — durum hiç değişmemişken — event log'a bir işlem satırı yazılırdı. Event log yalnız "gerçekte ne oldu"yu tutar; makbuz teknik bir tekrar korumasıdır. `PENDING` satırı transaction rollback olursa kendisi de geri alınır, zombi kalmaz. Tombstone'lar `expires_at` (sefer bitişi + 24 sa) sonrası çözülmemiş olarak denetime düşer.

---

## 5. Durum makinesi ve invariantların zorlanma mekanizması

**Sefer:** `PLANNED → READY → ACTIVE → COMPLETED`, ayrıca `CANCELLED` (yalnız ACTIVE öncesi), `SUSPENDED`, `ABORTED`, `AUTO_CLOSED` (enum'da, otomasyonu V1.1).

**Öğrenci (tek makine):**

```
EXPECTED → ON_BOARD → DELIVERED
        ↘ ABSENT_PLANNED
        ↘ NO_SHOW → ON_BOARD     (arkadan koşup yetişti — gerçek geçiş, "geri alma" değil)
        ↘ MOVED_OUT
ON_BOARD → DELIVERY_FAILED → { DELIVERED_LATE | RETURNED_TO_SCHOOL | HANDED_TO_ADMIN }
ON_BOARD → RETURNED_HOME
```

Sabah/akşam ayrı enum değil; fark `delivery_target`: `SCHOOL` (sabah), `HOME` (kodsuz), `TEMP` (**kod zorunlu**).

### Katmanlı zorlama

| Katman                      | Ne yapar                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/domain` (TS)      | **Tam geçiş matrisi** — hangi durumdan hangisine, hangi rolle, hangi sefer durumunda. Sunucuda yetki, mobilde UX |
| Fastify transaction         | Kilit + CAS + idempotency kapısı + **OTP kriptografisi** + geçiş kararı + event yazımı                           |
| DB: aynı satır CHECK        | Satır içi invariantlar (denormalize kolonlarla)                                                                  |
| DB: SQL fonksiyon + trigger | Çapraz tablo invariantları, kilit alarak                                                                         |
| DB: rol yetkisi             | `servisapp_api` rolünün `trip_student` üzerinde doğrudan UPDATE yetkisi yok                                      |

### Invariant 1 — TEMP teslimat kodsuz kapanamaz

Çapraz tablo CHECK mümkün değil (CHECK yalnız kendi satırını görür). Doğrulama sonucu `trip_student` satırına denormalize edilir ve invariant aynı satırda yazılır:

```sql
ALTER TABLE trip_student ADD CONSTRAINT temp_delivery_requires_verification CHECK (
  state <> 'DELIVERED'
  OR delivery_target <> 'TEMP'
  OR (delivery_method IN ('OTP','ADMIN_OVERRIDE') AND delivery_verified_at IS NOT NULL)
);
```

**OTP kriptografisi nerede çalışır:** Pepper ve şifreleme anahtarı Fly secret/KMS'te durur; **Postgres bu secret'ları bilmez ve bilmemelidir.** Bu yüzden doğrulama Fastify'da yapılır, DB yalnız atomikliği sağlar:

```
BEGIN
  SELECT delivery_override ... FOR UPDATE      -- DB: kilit + attempt_count/locked_until
  Fastify:  candidate = HMAC(pepper, girilen_kod)
            crypto.timingSafeEqual(candidate, otp_hmac)
  doğruysa: SELECT mark_delivery_verified(...)  -- SECURITY DEFINER, yalnız state geçişi
  yanlışsa: attempt_count++, gerekiyorsa locked_until
COMMIT
```

`mark_delivery_verified()` ve `admin_override_delivery()` dışında hiçbir yol `delivery_method` / `delivery_verified_at` kolonlarına yazamaz.

### Invariant 2 — Araçta öğrenci varken sefer kapanamaz

```
complete_trip(trip_id):
  SELECT * FROM trip WHERE id = ? FOR UPDATE            -- seferi kilitle
  trip_vehicle_check(phase='AFTER', vehicle_empty_confirmed) yoksa → EXCEPTION
  SELECT count(*) FROM trip_student
    WHERE trip_id = ?
      AND state IN ('EXPECTED', 'ON_BOARD', 'DELIVERY_FAILED')
  IF count > 0 → EXCEPTION
  UPDATE trip SET state='COMPLETED'
```

Çözülmemiş teslim başarısızlığı zaten `DELIVERY_FAILED` state'inin kendisidir — ayrı bir `resolution` kolonuna gerek yok; çözüldüğünde state `DELIVERED_LATE` / `RETURNED_TO_SCHOOL` / `HANDED_TO_ADMIN` olur.

Yarış koşulu: **her `trip_student` geçişi önce `trip` satırını `FOR SHARE` ile kilitler** ve `state='ACTIVE'` şartını doğrular; `complete_trip` `FOR UPDATE` aldığı için ikisi karşılıklı dışlanır. Ek güvenlik ağı: `trip` üzerinde `BEFORE UPDATE` trigger aynı sayımı tekrarlar.

---

## 6. Idempotency ve çakışma

| Problem                                                | Çözen mekanizma                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aynı komutun tekrar gönderilmesi                       | `command_receipt` üzerinde `UNIQUE(tenant_id, client_event_id)` — makbuz varsa saklı `response_json` aynen döner                                                                                                                         |
| **Şoför ve hostesin aynı öğrenciye aynı anda basması** | `client_event_id` bunu **çözmez** (iki cihaz iki farklı UUID). Çözen: `FOR UPDATE` + `expected_state_seq` CAS                                                                                                                            |
| Offline kuyruğun sırasız gelmesi                       | Sıra yalnız **batch içinde** `device_seq` ile; farklı batch'ler arası doğruluğu **CAS** sağlar. Katı kesintisiz sıra şartı yok — kaybolan bir `seq` kuyruğu sonsuza kilitlemesin. `device_seq` boşlukları teşhis/telemetri için loglanır |
| Geri almanın hedefinden önce gelmesi                   | `target_client_event_id` referansı; hedef yoksa `pending_command_dependency`'ye yazılır, hedef gelince uygulanır — **asla 404 dönmez**                                                                                                   |
| Cihaz saati kayması                                    | `occurred_at_device` + `received_at` ayrı; her senkronda saat farkı ölçülür. **`service_date` asla cihaz saatinden hesaplanmaz** — olay hangi `trip_id`'ye aitse onun tarihini alır                                                      |

### Transaction akışı (tek yol)

```
BEGIN
  1. INSERT command_receipt(client_event_id, status='PENDING') ON CONFLICT DO NOTHING
     → satır dönmediyse: replay → saklı response_json'ı dön, ÇIK
  2. SELECT trip FOR SHARE            → state='ACTIVE' mi?
  3. SELECT trip_student FOR UPDATE   → state_seq = expected_state_seq mi?
     → değilse: receipt='CONFLICT' · event: STUDENT_STATE_CONFLICT · needs_review=true · ÇIK
  4. domain.canTransition(...)        → izinli mi?
     → değilse: receipt='REJECTED' · ÇIK
  5. UPDATE trip_student SET state=..., state_seq = state_seq + 1
  6. INSERT event(...)                → gerçekte olan geçiş
  7. INSERT notification (outbox)     → pg-boss işleyecek
  8. receipt='APPLIED', response_json = yeni durum
COMMIT
```

**Varlık/yokluk çakışmasında otomatik kazanan seçmiyoruz.** Yanlış `NO_SHOW` = kapıda kalan çocuk; yanlış `ON_BOARD` = araçta sanılan ama evde olan çocuk. Çakışma iki cihazda da öğrencinin adı ve fotoğrafıyla gösterilir, insan onayı istenir, yöneticiye bildirim gider.

### Geri alma

Yalnız son işlem · 10 dakika içinde · o sefere atanmış kullanıcı · sefer kapandıktan sonra asla · OTP doğrulaması için asla. Kayıt silinmez. Veliye giden durum bildirimleri **60-90 sn geciktirilir**; bu sürede geri alınırsa bildirim hiç gitmez, sonra alınırsa açık bir "düzeltme" bildirimi gider.

### Personel değişimi

Yetki zaman dilimlidir: bir olay, aktörün `trip_crew_assignment` aralığı olayın zamanını kapsıyorsa kabul edilir. Böylece eski cihazın **değişimden önceki** olayları geçerli, sonrakiler reddedilir. Ayrıca `location_session_epoch` artırılır → eski cihazdan gelen GPS otomatik düşer, cihaza önbellek temizleme + takibi durdurma komutu gider.

---

## 7. İstisnalar girdidir — ama operasyon gerçeğini ezemez

```
reconcile_day_plan(trip_id) =
    rota snapshot + ride_exception + delivery_override + student_trip_move + tatil
  → PLAN katmanının deterministik projeksiyonu
  + (sefer ACTIVE ise) farkın kritik değişiklik uyarısı
```

**Kritik sınır:** Sefer başladıktan sonra `trip_student` yalnız bir plan projeksiyonu değildir — içinde fiziksel gerçeklik vardır. Reconcile **plan** alanlarını üretir (katılım beklentisi, beklenen durak, teslim hedefi, rota üyeliği); **operasyon state'ini** asla yeniden yazamaz.

**Değiştirilemez operasyonel gerçekler:** `ON_BOARD` · `DELIVERED` · `DELIVERY_FAILED` · `DELIVERED_LATE` · `RETURNED_TO_SCHOOL` · `HANDED_TO_ADMIN` · `RETURNED_HOME`.

### Reconcile precedence tablosu

| Mevcut state                            | Gelen istisna                          | Sonuç                                                             |
| --------------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `EXPECTED`                              | `ride_exception`                       | → `ABSENT_PLANNED`                                                |
| `EXPECTED`                              | `delivery_override`                    | teslim hedefi `TEMP` olur, state değişmez                         |
| `NO_SHOW`                               | `ride_exception`                       | yok sayılır, `needs_review` işaretlenir                           |
| `ON_BOARD`                              | `ride_exception`                       | **reddedilir** → "hedef/teslim değişikliği" akışına yönlendirilir |
| `DELIVERED` ve diğer terminal state'ler | herhangi                               | operasyon değişmez; yalnız bilgi olayı yazılır                    |
| herhangi                                | `student_trip_move` (sefer başlamadan) | kaynakta `MOVED_OUT`, hedefte yeni satır                          |
| `ON_BOARD`                              | `student_trip_move`                    | **reddedilir** — çocuk fiziksel olarak araçta                     |

Bu tablo olmadan kural uygulama kodunda saçaklanır. `packages/domain`'de tek fonksiyon olarak yaşar ve doğrudan test edilir.

**Sefer üretimi:** Her akşam 18:00'de 7 günlük ufuk + 04:00'te onarım geçişi. Gece yarısı üretmiyoruz — 00:05'te patlayan bir job sabah 06:40'ta şoför tarafından keşfedilir. `UNIQUE(tenant_id, route_id, service_date)` + advisory lock ile çift üretim imkânsız; kalıcı katmandaki her değişiklik açık seferler için reconcile işini kuyruğa atar.

**Zaman kuralı:** Tüm anlar `timestamptz`, `service_date` bir `DATE` ve seferden gelir. Gece yarısını geçen sefer tarih değiştirmez. Gösterim daima `tenant.timezone` ile.

**Kritik zamanlama:** `PLANNED`/`READY` iken değişiklik sessizce uygulanır. `ACTIVE` iken kritik değişiklik uyarısı çıkar, personel onaylayana kadar durur, uyarı durak bazlıdır ve araç o durağı geçtiyse otomatik düşer.

---

## 8. Canlı konum, akıcı harita ve event-driven Routes

### Temel prensip

**Canlı araç takibi ile Google Routes tamamen ayrıdır.**

```
Konum         = telefon GPS'i
Canlı görüntü = GPS + istemci tarafı görsel interpolation
ETA           = ServisApp motoru
Google Routes = başlangıç referansı + gerektiğinde yeniden hesaplama
Google Maps   = harita/navigasyon katmanı
```

```
Personel telefonu GPS → Fastify → vehicle_current_location
                                     ↓
                        Realtime / polling → Veli uygulaması → smooth animasyon
```

### GPS toplama ve kaynak cihaz

Sefer `ACTIVE` olduğunda personel uygulaması konum servisini başlatır; hareket hâlinde **5-10 saniyede bir** örnek, uzun hareketsizlikte seyrelir. Gönderilen veri: `lat, lng, accuracy, speed, heading, recorded_at, trip_id, device_id, session_epoch`.

**Kaynak cihaz belirsizliği çözülür:** Crew app'i hem şoför hem hostes kullanır; iki telefon da gönderirse marker zıplar. Bu yüzden sefer başında **tek bir cihaz canlı konum kaynağı** olarak işaretlenir (`trip.location_source_device_id`, varsayılan: şoför cihazı, hostes failover). Kaynak değişince `location_session_epoch` artar ve eski epoch'lu ping'ler **reddedilir**. Bu, şoför değişimi problemini de aynı mekanizmayla çözer.

Sunucu her yeni konumda: **(1)** kalite kontrolü → **(2)** sıçrama filtresi → **(3)** `vehicle_current_location` güncelle → **(4)** gerekliyse yayın → **(5)** ETA motoruna ver → **(6)** seyreltilmiş arşiv kaydı (30 sn, 14 gün).

### GPS kalite filtresi

Reddedilen/işaretlenen durumlar: `accuracy` eşiğin üstünde · imkânsız hız değişimi · yüzlerce metrelik ani sıçrama · eski `recorded_at` · yanlış `trip_id` · yanlış `session_epoch` · yetkisi bitmiş cihaz. Bu durumda **son güvenilir koordinat korunur**; veliye yanlış konum göstermek yerine "canlı konum geçici olarak güncellenemiyor" gösterilir.

### Akıcı veli haritası

> **Backend yalnız gerçek GPS koordinatı yayınlar. İstemci, iki sunucu güncellemesi arasında görsel marker geçişini interpolate eder; bu animasyon yeni konum verisi olarak kabul edilmez ve backend'e geri yazılmaz.**

Yeni koordinat geldiğinde marker mevcut konumundan hedefe easing ile ilerler; sonuç veli için kesintisiz hareket, veri için hâlâ ölçülmüş GPS. **Backend güncelleme frekansı ile animasyon FPS'i birbirinden bağımsızdır** — harita 60 FPS akarken sunucu 10 saniyede bir koordinat gönderebilir.

### Kontrollü yayın — sefer başına TEK ortak payload

```json
{ "vehicle_lat": ..., "vehicle_lng": ..., "heading": ...,
  "recorded_at": ..., "quality": "GOOD" }
```

**1 araç GPS güncellemesi = 1 broadcast.** Veliye özel veriler (kendi durağı, kendi çocuğunun ETA'sı ve durumu) broadcast'te değil **parent API yanıtında** taşınır. Bu ayrım yapılmazsa "1 GPS × 40 veli = 40 kişiselleştirilmiş mesaj" tasarımına kayarız.

- Kanal `private: true`, `realtime.messages` üzerinde RLS ile korunur.
- Kanala giriş şartı: `trip.state = ACTIVE` **ve** guardian → student → trip_student ilişkisi **ve** öğrenci o seferde henüz tamamlanmamış.
- Veli yalnız canlı harita ekranı açıkken bağlanır.
- Yayın sıklığı 5-10 sn; yük/maliyet artarsa 10-15 sn — interpolation sayesinde UX bozulmaz.
- Soket kurulamazsa polling fallback (10-15 sn).
- Taşıyıcı `RealtimeTransport` arayüzü arkasında; kota zorlanırsa Fastify WS + `LISTEN/NOTIFY`'a tek dosyayla geçilir.

**Erişimin gerçekten kesilmesi:** Supabase Realtime yetki politikaları **kanala girerken** değerlendirilip bağlantı boyunca cache'lenir; öğrenci `DELIVERED` oldu diye açık websocket kendiliğinden kapanmaz. Bu yüzden dört adım birlikte uygulanır:

1. Sunucu kanala `TRIP_TRACKING_ENDED` yayınlar,
2. istemci unsubscribe olur ve ekranı "sefer tamamlandı" durumuna alır,
3. sunucu kendi aktif-izleyici kaydından düşürür,
4. polling ucu bundan sonra `410 Gone` döner.

### Veli haritasında gizlilik

**Görebilir:** servis aracı · kendi durağı · kendi çocuğunun yaklaşık ETA'sı.
**Göremez:** diğer öğrencilerin durakları/adresleri · bütün rota durakları · geçmiş araç izi · diğer öğrencilerin ETA'ları.

### Watchdog

| Süre     | Davranış                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------- |
| > 30 sn  | Veri stale sayılmaya başlar                                                                          |
| 30-60 sn | Personel cihazında "konum servisini kontrol edin"                                                    |
| > 3 dk   | Yönetici: "Araçtan 3 dakikadır konum alınamıyor" · Veli: "canlı konum geçici olarak güncellenemiyor" |

Sefer durmaz. **Eski konum canlıymış gibi gösterilmez.** Cihaz tarafında kendini toparlayan yeniden başlatma; kurulumda Xiaomi/Huawei/Samsung için pil optimizasyonu rehberi. İzin akışı kademeli: önce foreground; servis arka plandan yeniden başlatılamıyorsa gerekçesiyle arka plan izni istenir.

### ETA motoru — ServisApp hesaplar

Sefer başlarken **1 × `route_baseline` job'ı** çalışır. ComputeRoutes tek istekte max 25 ara durak desteklediği için bu job 1-3 HTTP request'i olabilir:

```
Toplam nokta ≤ 27 → 1 × ComputeRoutes
Toplam nokta > 27 → sıra BOZULMADAN parçala → 2-3 × ComputeRoutes
                    → RouteLeg süreleri tek route_baseline altında birleştirilir
```

**Sequential assembly (önemli):** Parçaların hepsine `departureTime = now` verilmez — araç ikinci parçaya belki 35 dakika sonra ulaşacaktır. Doğrusu:

```
chunk1.departureTime = seferin fiili kalkışı
chunk2.departureTime = chunk1'in tahmini varışı
chunk3.departureTime = chunk2'nin tahmini varışı
```

Böylece trafik tahmini zaman olarak tutarlı olur.

Sefer boyunca ETA yerel olarak düzeltilir:

```
baseline: A→B 5dk, B→C 7dk, C→D 6dk, D→okul 10dk
araç A→B'yi 7 dk'da geçti → "plandan yavaş ilerliyor"
live_eta = remaining_baseline_time × observed_delay_factor
```

Tek global katsayı yerine **yakın geçmiş segmentlere daha fazla ağırlık** verilir.

**Geçmiş sefer verisi:** `route_segment_stat` yeterli örnek biriktiğinde devreye girer — aynı servis pazartesi 07:20'de A→B'yi son 30 seferde ortalama 8 dk 12 sn geçtiyse, Google 6 dk dese bile geçmiş bilgi ağırlık kazanır. ML yok; **median + recent weighted average**. Veri yokken kendiliğinden devre dışı.

### `eta_confidence`

Dahili güven skoru (0-1 veya HIGH/MEDIUM/LOW). Etkileyenler: son GPS'in yaşı · accuracy · araç rota üzerinde mi · son segmentlerin tahminle uyumu · uzun bekleme · hız anomalisi · baseline yaşı · rota değişimi. **Veliye gösterilmez**; Google'ı tekrar çağırma kararını bu verir.

### Event-driven Routes — zamana değil olaya bağlı

Sabit "her N dakikada bir çağır" kuralı **yoktur**. Yeni çağrı yalnız şunlardan biriyle:

1. Rota dışına çıkma (ör. 300-500 m eşik)
2. Durak dışında beklenmeyen uzun duruş (3-5 dk)
3. `eta_confidence < threshold`
4. Tahminin ciddi sapması (6 dk hesaplanırken gerçek sürekli 10-12 dk)
5. Günlük rotanın değişmesi (öğrenci çıkarıldı, TEMP teslimat eklendi, öğrenci taşındı)
6. Aracın sapıp yeniden rota gerektirmesi

**Guardrail:** `minimum_route_refresh_interval` (ör. 5 dk) ve `max_routes_calls_per_trip` (başlangıç 5).

### Veliye gösterilen ETA

❌ `3 dakika 27 saniye` · ✅ `Yaklaşık 4 dk` / `3-5 dk` · güven düşükse `Yaklaşıyor`. Aracın haritadaki konumu her hâlükârda gerçek GPS'ten.

### "Servis yaklaşıyor" bildirimi

`ETA <= tenant.approach_notification_minutes` (varsayılan 5 dk), ama **tek ölçümle tetiklenmez** — iki ardışık hesapta eşik doğrulanır (5→7→5→7 dalgalanmasında spam olmasın). Öğrenci başına seferde en fazla 1 (`approach_notified_at`).

### Rota sıralama önerisi ve matrix planner

- Durak ≤ 25 → `optimizeWaypointOrder` (11+ durakta SKU'nun yükseldiğini bilerek).
- \> 25 → Matrix + nearest-neighbor + 2-opt. **Matrix element başına faturalanır ve istek başına max 625 element** kabul eder, bu yüzden bir _matrix planner_ gerekir:
  ```
  aday kenarlar (haversine ön eleme)
    → 625'lik batch'lere böl
    → sınırlı eşzamanlılık
    → stop_travel_time_cache'e yaz
  ```
- **Lazy edge materialization:** 2-opt `A-C` gibi önceden sorulmamış bir kenarı denemek isteyebilir. Kural: cache'te varsa gerçek süre · yoksa haversine tahmini · yüksek potansiyelli swap ise o kenar **talep üzerine** matrix'ten doldurulur. Aksi hâlde "2-opt uyguluyoruz" deyip eksik graf üzerinde çalışırız.
- Yalnız rota kurulumunda ve büyük düzenlemede çalışır, **asla günlük değil**. Durak sayısı öğrenci sayısı değildir — 40 öğrenci tipik olarak 20-30 durak eder.
- Her çağrının element sayısı ve tahmini bedeli loglanır; günlük bütçe eşiği aşılırsa **yalnız bu ertelenebilir kurulum işi** durur. **Sefer sırasındaki operasyonel çağrılar asla bütçe nedeniyle engellenmez** (bkz. §15 notu).

### Maliyet modeli

Google kullanımını **araç konumu sayısı değil, gerçek Routes hesaplama ihtiyacı** belirler. 10 araç × 4 sefer/gün × 22 gün = 880 sefer/ay; sefer başına 1-3 baseline request + nadiren refresh → ~1.000-2.500 request/ay. Veli ekranındaki binlerce GPS hareketi bu sayıyı **hiç artırmaz**.

---

## 9. Farklı teslimat + OTP

```
Veli → "Bugün farklı adrese bırak" → haritada pin + teslim alacak kişinin adı/telefonu
  ↓ max_detour_m kontrolü
  ├─ sınır içi → otomatik
  └─ uzak → YÖNETİCİ ONAYI (ekstra mesafe + ETA etkisi gösterilir)
  ↓
6 haneli kod (CSPRNG) → veli uygulamasında görünür + Netgsm SMS
Sunucuda iki ayrı biçimde:
   otp_hmac       → doğrulama (pepper ile; geri çözülemez)
   otp_ciphertext → YALNIZ yeniden gönderim (anahtar Fly secret/KMS'te)
Personele NE KOD NE HASH NE CIPHERTEXT gider.
  ↓
Araç adreste → hostes kodu girer → Fastify HMAC + timingSafeEqual (bkz. §5)
  ├─ doğru → mark_delivery_verified() → "Teslim edildi" açılır + ciphertext silinir
  └─ 5 yanlış → kilit; tek çıkış: admin override (telefonla doğrulama + zorunlu gerekçe)
  ↓
TÜM velilere bildirim: "Farklı teslimat talebi Kadriye Aydın tarafından oluşturuldu"
```

Kod tek kullanımlık; sefer sonunda ve gün bitiminde geçersiz (ciphertext de silinir). Tekrar gönderim **aynı kodu** döndürür: sunucu ciphertext'i çözüp yeniden SMS'ler, yeni kod üretmez — SMS'ler sırasız gelirse veli eski mesajı okur ve kapıda kod tutmaz. `resend_count` sınırlı. Veli iptal ederse kod iptal edilir, personele kritik değişiklik düşer. Öğrenci `ABSENT_PLANNED`/`NO_SHOW` olursa override otomatik iptal.

**İnternet yoksa:** teslim yalnız admin override ile. Kodun hash'ini cihaza indirmek yok — bu yol kuralın kendisini yıkar.

**Velayet:** `can_authorize_temp_address` yetkisi olmayan veli farklı adres oluşturamaz; oluşturulduğunda tüm velilere bildirim gider. Asıl koruma bu bildirimdir, OTP hız kesicidir.

---

## 10. Ekranlar

**Veli (6 ekran):** Ana ekran · Canlı servis · Çocuğum · Bugün kullanmayacak (Sabah/Akşam/İkisi) · Farklı teslimat · Bildirimler & Profil.

**Personel:** Sürüş sırasında ekranda üç bilgi — **sıradaki öğrenci kim, nereye gidiyorum, durum ne.** Bugünkü seferler · Sefer ekranı (fotoğraflı kart, büyük Bindi/Binmedi) · Öğrenci/durak listesi · Navigasyonu başlat · Teslim doğrulama · Sorun bildir · **Sefer öncesi/sonrası araç kontrolü**. Kritik değişiklik uyarısı onaylanana kadar ekranda kalır. Şoför öğrencinin "hayat hikâyesini" görmez: ad, fotoğraf, durak, teslim bilgisi, bir veli telefonu.

**Yönetici:** Bugün · Seferler · Rotalar · Okullar · Öğrenciler (içe aktarma: hazır / düzeltilmeli / adres / benzersiz telefon = davet sayısı) · Filo · İstisnalar (API yoksa dürüst boş) · Olaylar (liste yoksa dürüst boş). Canlı konum yan menüde yoktur; GPS gelince Bugün → sefer detay → Canlı. Davet SMS'i rota yayınına bağlı değildir.

---

## 11. KVKK ve mevzuat

- **Aydınlatma metni ile açık rıza ayrı ayrı düzenlenir** (KVKK Kurulu 18.02.2026 / 2026-347 ilke kararı iç içe metinleri hukuka aykırı sayıyor). "Battaniye" rıza geçersiz.
- **Her işleme açık rızaya dayanmak zorunda değil** — hatta başka bir hukuki sebep varsa ayrıca açık rıza alınmamalıdır. Bu yüzden hukukçuyla birlikte bir matris çıkarılacak:
  `veri kategorisi → amaç → hukuki sebep → saklama süresi → aktarım`
- **V1'de sağlık verisi toplanmıyor.** En iyi KVKK önlemi, gerekmeyeni hiç toplamamak.
- Veri yurt dışında (Supabase + Fly EU): uygun güvence yöntemi (standart sözleşme / taahhütname / diğer) **seçilerek** uygulanacak — bunlar birbirinin eşanlamlısı değil. Müşteri sözleşmesine veri işleyen maddeleri girecek.
- **VERBİS yükümlülüğü otomatik değildir** — çalışan sayısı/mali bilanço gibi kriterlere bağlı istisnalar var. Veri sorumlusu (müşteri) bazında değerlendirilecek.
- Saklama: GPS ping 14 gün, olay kaydı 1 yıl, öğrenci ayrılınca fotoğraf silinir. Silme talebinde profil silinir, olay kaydı takma kimlikle korunur.
- Şoför konumu **yalnız sefer ACTIVE iken** toplanır; sefer bitince cihaza "takibi durdur" komutu gider.
- Yönetici paneline MFA + "kim hangi çocuğun adresine baktı" erişim kaydı.

---

## 12. Operasyonel emniyet kemerleri

| Kalem                              | Neden                                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Minimum desteklenen app sürümü** | Durum makinesi 3 ay sonra değişir; 4 aylık APK'yla sefer açan şoför tehlikelidir. Sunucu `426 Upgrade Required` dönebilmeli. `schema_version` + `min_supported_app_version` sunucuda tutulur |
| **Sunucu tarafı feature flag**     | İlk müşteride sorun çıkaran özelliği mağaza sürümü beklemeden kapatabilmek                                                                                                                   |
| **Kill switch (ayrı ayrı)**        | GPS toplama · OTP · realtime yayını bağımsız olarak devre dışı bırakılabilsin                                                                                                                |
| **Restore testi**                  | Yedeğin var olması ile geri yükleyebilmek aynı şey değil. Faz 9'da gerçek restore provası yapılır                                                                                            |
| **Observability**                  | `request_id` + `command_id` + `trip_id` + `tenant_id` taşıyan structured log; Sentry + OpenTelemetry. Bir velinin "servis gelmedi" iddiası tek sorguyla izlenebilmeli                        |

---

## 13. Test stratejisi

- **Birim (Vitest, `packages/domain`):** tam geçiş matrisi, **reconcile precedence tablosu**, kapasite (koltuk sayısı değil **anlık zirve doluluk**), OTP kuralları, ETA tahmini.
- **DB invariant testleri (testcontainers, gerçek migration'lar):** üstünde `ON_BOARD` öğrenci varken `COMPLETED` denemesi · doğrulanmamış `TEMP` teslimat · `servisapp_api` rolüyle `event` UPDATE denemesi · çapraz tenant kaydı bağlama denemesi (bileşik FK yakalamalı) · iki eşzamanlı transaction'la CAS yarışı.
- **Snapshot invariant testi (en önemlisi):** dün üretilmiş bir seferi al → `route`, `route_stop`, `stop`, `address` kayıtlarını tamamen değiştir → seferin operasyonel çıktısı **birebir aynı kalmalı** ve sefer bu tablolara hiç dokunmadan tamamlanabilmeli.
- **RLS testi:** `servisapp_api` rolüyle, `app.tenant_id` set edilmeden ve yanlış tenant ile sorgu denemeleri.
- **`apps/simulator`:** 100 araç × 40 öğrenci gerçek zamanlı GPS akışı.
  - _Operasyon:_ zayıf/kesik internet · GPS kaybı · uygulama çökmesi · çift tıklama · şoför+hostes aynı öğrenci · sırasız replay · veli son anda iptal · farklı teslimat · 5 yanlış OTP · sefer ortasında araç/şoför değişimi · tünelden çıkan 100 aracın aynı anda senkronu.
  - _Konum & ETA:_ smooth interpolation · GPS jitter · 100 m teleport · 500 m sapma · uzun trafik beklemesi · Routes refresh trigger · refresh rate-limit · `eta_confidence` düşüşü · GPS stale · Realtime → polling fallback · **iki cihazdan aynı anda GPS (epoch reddi)**.
- **Ölçekli koşu raporu:** `GPS packets · Realtime messages · Routes baseline requests · Routes refresh calls · calls/trip · ETA MAE · ETA p95`.
  **Hedefler:** baseline request/sefer = durak sayısının gerektirdiği kadar (1-3) · refresh çağrısı/sefer ≈ 0, ortalama < 0.5 · **broadcast mesajı = GPS güncellemesi sayısı** (veli sayısıyla çarpılmamış olmalı — kişiselleştirilmiş yayın regresyonunu bu yakalar). ETA doğruluğu kötüleşiyorsa bu hedefler uğruna çağrı engellenmez.
- **Mobil E2E (Maestro):** iOS simülatör + Android emülatör; sabah seferi uçtan uca, akşam OTP'li teslimat, offline işaretleme + senkron.
- **Saha provası:** yayın öncesi 1 araçla 3 gün gerçek sefer.

---

## 14. Fazlar

Her faz, testleri yeşil ve o fazın invariantları DB'de zorlanmadan kapanmaz.

| Faz                           | İçerik                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Temel**                  | Repo'yu `~/Developer/ServisApp`'e taşı · monorepo + Turborepo · TS/ESLint · Supabase (EU) projesi · **üç DB rolü + bağlantı stratejisi** · Fly.io app · CI (typecheck + test) · env/secret yönetimi · **structured log + Sentry/OTel iskeleti**                                                                                                                                                                                                          |
| **1. Veri modeli & domain**   | Drizzle şema (tenant_id + bileşik FK · **identity/membership** · **trip_stop snapshot**) · RLS politikaları · `command_receipt` + `pending_command_dependency` · SQL fonksiyonlar (`complete_trip`, `mark_delivery_verified`, `admin_override_delivery`) · trigger backstop'lar · seed · `packages/domain`: geçiş matrisi + **reconcile precedence** + kapasite · **DB invariant + snapshot + RLS testleri**                                             |
| **2. Kimlik & kurulum**       | Supabase Auth (veli: telefon+SMS OTP · personel/admin: e-posta+şifre) · membership/rol yetkilendirme · **min app version + feature flag altyapısı** · admin: okul/araç/personel/öğrenci/veli + adres pin doğrulama                                                                                                                                                                                                                                       |
| **3. Rota**                   | Rota oluşturma · sıralama önerisi (≤25 optimize / >25 matrix planner + lazy edge + 2-opt) · sürükle-bırak · versiyonlama/yayınlama                                                                                                                                                                                                                                                                                                                       |
| **4. Sefer motoru**           | Sefer üretimi (7 gün ufuk + onarım) · yaşam döngüsü · `trip_student` durumları · **araç boş kontrolü** · olay kaydı                                                                                                                                                                                                                                                                                                                                      |
| **5. Personel app**           | Sefer ekranı · öğrenci kartları · bindi/binmedi/teslim · **offline outbox + CAS + çakışma ekranı** · navigasyona devretme · sorun bildir · "devam eden sefer bulundu"                                                                                                                                                                                                                                                                                    |
| **6. Canlı takip & veli app** | Telefon GPS katmanı + foreground/background lifecycle + watchdog · GPS kalite filtresi · **kaynak cihaz + session epoch** · `vehicle_current_location` · kontrollü Realtime + polling fallback + **TRIP_TRACKING_ENDED** · smooth marker interpolation · Routes baseline (sequential chunk assembly) · ETA motoru · `eta_confidence` · event-driven refresh + guardrail · segment istatistiği · "yaklaşıyor" · veli ana ekran + gizlilik filtreli harita |
| **7. İstisnalar**             | "Bugün kullanmayacak" · kritik değişiklik uyarı+onay · farklı teslimat + OTP (Fastify kripto) + SMS + mesafe kontrolü + yönetici onayı · adres değişiklik talebi                                                                                                                                                                                                                                                                                         |
| **8. Operasyon & panel**      | Sefer bazlı araç/şoför/hostes değişimi · öğrenci transferi · kapasite · yönetici canlı harita · öncelikli olaylar · olay kayıtları · CSV                                                                                                                                                                                                                                                                                                                 |
| **9. Sertleştirme & yayın**   | Simülatör senaryoları · yük testi · güvenlik gözden geçirmesi · **kill switch'ler + restore provası** · KVKK metinleri · mağaza gönderimi · saha provası · operasyon el kitabı                                                                                                                                                                                                                                                                           |

---

## 15. Maliyet — 40-50 araçla başlangıç

| Kalem                 | Başlangıç                                                                 | 100 araç                                                                                                               |
| --------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Supabase Pro          | $25-30                                                                    | $25-30 (+ pik: 500 eşzamanlı bağlantı dahil, sonrası 1.000'lik paket başına $10; 5M mesaj dahil, sonrası $2,50/milyon) |
| Fly.io API            | $6-12 (2×512 MB shared-cpu-1x ile başla, **ölç sonra büyüt**)             | $12-20                                                                                                                 |
| Vercel (admin)        | $0                                                                        | $0-20                                                                                                                  |
| Google Maps / Routes  | **$0 hedef** — event-driven Routes. Mobil harita gösterimi zaten ücretsiz | çoğu kullanımda **$0 hedef**, yoğun sapmada kullanım kadar                                                             |
| Netgsm SMS            | kullandığın kadar (~₺150-300)                                             | ~₺300-500                                                                                                              |
| Expo Push · EAS Build | $0 · $0-19                                                                | aynı                                                                                                                   |
| **Toplam**            | **≈ $35-50/ay**                                                           | ölçüp büyütülecek                                                                                                      |

> **SKU notu:** Çağrıların SKU'su waypoint sayısına, optimization ve routing seçeneklerine göre **Essentials veya Pro** olabilir — hepsi Essentials değildir. Hedef hacim hem 10.000 Essentials hem 5.000 Pro ücretsiz kullanım bandının altında tutulacak.

> **Maliyet hedefi doğruluk azaltılarak elde edilmeyecektir.** Araç konumu daima gerçek telefon GPS'inden gelir. Routes çağrıları yalnız ETA/rota hesabı içindir ve güven skoru gerekli gördüğünde tekrarlanır. Ücretsiz kota aşılırsa sistem çağrıyı körlemesine durdurmaz; gerekli çağrı yapılır ve maliyet kabul edilir. **$3 tasarruf için yanlış ETA vermiyoruz.**

Apple Developer $99/yıl · Google Play $25 tek seferlik. 40.000 öğrenci ölçeğinde mimari aynı kalır, yalnız Supabase compute ve Fly instance büyür.

---

## 16. Senden gereken ön koşullar

Google Cloud faturalandırma + Maps API anahtarı (bütçe alarmı kurulacak) · Supabase hesabı · Fly.io hesabı · Netgsm OTP SMS paketi + API bilgileri (başlık onayı birkaç gün sürebilir) · Apple Developer + Google Play Console hesapları · Android emülatör testi için Android Studio (bu makinede kurulu değil) · pilot müşterinin gerçek verisi (okul, araç, personel, 1 rotalık öğrenci listesi).

---

## 17. V1'e girmeyecekler

AI rota optimizasyonu · kendi navigasyon motorumuz · ödeme/muhasebe · not/devamsızlık · kamera streaming · QR/NFC/yüz tanıma · WhatsApp botu · ikinci harita sağlayıcısı · karmaşık raporlama · ML tabanlı ETA · şoför puanlama · marketplace.

---

## Doğrulama

- `pnpm test` — domain birim testleri + DB invariant/snapshot/RLS testleri (her faz sonunda yeşil).
- `pnpm --filter simulator start -- --vehicles=100 --scenario=all` — sonunda: hiçbir sefer `ON_BOARD` öğrenciyle kapanmamış · hiçbir öğrenci çift durumda değil · hiçbir `TEMP` teslimat doğrulanmamış kodla kapanmamış · hiçbir `event` satırı güncellenmemiş · broadcast sayısı veli sayısıyla çarpılmamış olmalı.
- Snapshot provası: dünün seferini al, rota/durak/adres kayıtlarını değiştir, seferin çıktısının değişmediğini doğrula.
- Fiziksel cihaz provası: bir iPhone + bir Android'de gerçek sefer; uçak modu ile offline kuyruk, GPS kapatıp açarak watchdog, uygulamayı öldürüp açarak "devam eden sefer", ikinci cihazdan GPS göndererek epoch reddi.
- Routes bütçe & doğruluk raporu: `calls/trip`, `ETA MAE`, `ETA p95` ve matrix element sayısı birlikte değerlendirilir.
- Akıcılık gözle doğrulama: sunucu 10 sn'de bir koordinat gönderirken marker kesintisiz hareket ediyor mu; GPS teleport enjekte edilince zıplamak yerine son güvenilir konumda kalıp uyarı gösteriyor mu.
- Restore provası: yedekten yeni bir ortama geri yükle, uygulamayı ona bağlayıp bir sefer aç.
