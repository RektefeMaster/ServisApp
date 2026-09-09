# ServisApp

Okul servisi operasyon sistemi: sabit rota + günlük istisna motoru + canlı sefer +
öğrenci durum takibi + güvenli farklı teslimat + sağlam olay kaydı.

Onaylanmış kapsam ve mimari kararlar: **[SPEC.md](./SPEC.md)** (rev. 3.2).

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
curl localhost:3000/health/ready      # {"status":"ok"}
```

Üretim ortamı için `.env.example` kullanılır; parolalar ve kriptografik sırlar
Fly secret olarak tutulur, repoya girmez.

## Komutlar

| Komut                     | Ne yapar                                                     |
| ------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                | Tüm geliştirme süreçlerini başlatır                          |
| `pnpm build`              | Bağımlılık sırasına göre derler                              |
| `pnpm typecheck`          | Tip kontrolü                                                 |
| `pnpm lint`               | ESLint                                                       |
| `pnpm test`               | Birim + entegrasyon testleri                                 |
| `pnpm db:bootstrap-roles` | Uygulama rollerini oluşturur (idempotent, parolalar env'den) |
| `pnpm db:generate`        | Şemadan migration üretir                                     |
| `pnpm db:migrate`         | Migration'ları uygular (doğrudan bağlantı)                   |
| `pnpm db:seed`            | Yerel demo tohumu                                            |

## Yapı

```
apps/api        Fastify — iş mantığının tamamı burada
packages/domain Saf kurallar: durum makinesi, reconcile, kapasite
packages/contracts  zod şemaları = API sözleşmesi
packages/db     Drizzle şema, migration, RLS, fonksiyonlar, roller
```

## Değişmez kurallar

Bunlar ürünün var oluş sebebi; kod incelemesinde pazarlık konusu değildir (SPEC §1, §5):

1. Sefer, üstünde `ON_BOARD` öğrenci varken kapatılamaz.
2. Farklı adrese teslim, sunucuda doğrulanmış OTP olmadan tamamlanamaz.
3. OTP kodu, hash'i ve ciphertext'i personel cihazına **hiç** gitmez.
4. Günlük istisnalar kalıcı rotayı değiştirmez.
5. Sefer başladıktan sonra `route`/`stop`/`address` tablolarına bakmadan tamamlanabilir.
6. Olay kaydı append-only; uygulama rolünün UPDATE/DELETE yetkisi yoktur.
