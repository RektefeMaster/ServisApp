# ServisApp

Okul servisi operasyon sistemi: sabit rota + günlük istisna motoru + canlı sefer +
öğrenci durum takibi + güvenli farklı teslimat + sağlam olay kaydı.

Onaylanmış kapsam ve mimari kararlar: **[SPEC.md](./SPEC.md)** (rev. 3.3).

## Gereksinimler

- Node **24.20.0** (`.nvmrc` — `nvm use`)
- pnpm 10.34.5
- Docker (API imajı ve yerel Postgres testleri için)

## Yerel kurulum

```bash
nvm use
pnpm install
docker compose up -d                  # Postgres 17 (üretimdeki Supabase ile aynı sürüm)
cp .env.development.example .env
pnpm db:migrate                       # şema, RLS, fonksiyonlar
pnpm db:bootstrap-roles               # servisapp_api / servisapp_worker parolaları
pnpm --filter @servisapp/api dev
pnpm --filter @servisapp/api dev:worker   # kuyruk (ayrı süreç)
curl localhost:3000/health/ready          # {"status":"ok"}
```

`pnpm dev` API (3000), yönetim paneli (3001), veli Metro (8081) ve personel Metro
(8082) süreçlerini birlikte açar. Worker ayrıdır: `pnpm dev:worker`.

Üretim ortamı için `.env.example` kullanılır; parolalar ve kriptografik sırlar
Fly secret olarak tutulur, repoya girmez. İstemciler yalnız publishable/anon anahtar
görür; `service_role` tarayıcıya ve telefona girmez.

## Komutlar

| Komut                     | Ne yapar                                                     |
| ------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                | API + admin + veli + personel                                |
| `pnpm dev:api`            | Yalnız Fastify                                               |
| `pnpm dev:worker`         | pg-boss kuyruk işçisi                                        |
| `pnpm build`              | Bağımlılık sırasına göre derler                              |
| `pnpm typecheck`          | Tip kontrolü                                                 |
| `pnpm lint`               | ESLint                                                       |
| `pnpm test`               | Birim + entegrasyon testleri                                 |
| `pnpm db:bootstrap-roles` | Uygulama rollerini oluşturur (idempotent, parolalar env'den) |
| `pnpm db:platform`        | Kill switch / min app sürümü (`--kill-gps=true` …)           |
| `pnpm db:generate`        | Şemadan migration üretir                                     |
| `pnpm db:migrate`         | Migration'ları uygular (doğrudan bağlantı; hosted'a değil)   |
| `pnpm db:seed`            | Yerel demo tohumu                                            |

## Yapı

```
apps/api         Fastify — iş mantığının tamamı burada
apps/admin       Next.js + Tailwind (shadcn hazır)
apps/parent      Expo 57 — veli
apps/crew        Expo 57 — şoför + hostes
apps/simulator   yük & saha senaryosu (`--vehicles` `--scenario`)
packages/domain  Saf kurallar: durum makinesi, reconcile, kapasite
packages/contracts  zod şemaları = API sözleşmesi
packages/db      Drizzle şema, migration, RLS, fonksiyonlar, roller
packages/ui      paylaşılan tema / RN bileşenleri
packages/config  ortak tsconfig
docs/            domain, KVKK taslakları, operasyon, mağaza, saha
```

Simülatör (SPEC §13):

```bash
pnpm --filter @servisapp/simulator start -- --vehicles=100 --scenario=all
```

## Değişmez kurallar

Bunlar ürünün var oluş sebebi; kod incelemesinde pazarlık konusu değildir (SPEC §1, §5):

1. Sefer, üstünde `ON_BOARD` öğrenci varken kapatılamaz.
2. Farklı adrese teslim, sunucuda doğrulanmış OTP olmadan tamamlanamaz.
3. OTP kodu, hash'i ve ciphertext'i personel cihazına **hiç** gitmez.
4. Günlük istisnalar kalıcı rotayı değiştirmez.
5. Sefer başladıktan sonra `route`/`stop`/`address` tablolarına bakmadan tamamlanabilir.
6. Olay kaydı append-only; uygulama rolünün UPDATE/DELETE yetkisi yoktur.
