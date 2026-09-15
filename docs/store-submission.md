# Mağaza gönderimi

Apple Developer ($99/yıl) ve Google Play ($25) hesapları yayıncınındır. Bu dosya
kontrol listesidir; gönderimi yapmaz.

## Uygulamalar

| Uygulama | Bundle / paket         | EAS                    |
| -------- | ---------------------- | ---------------------- |
| Veli     | `app.servisapp.parent` | `apps/parent/eas.json` |
| Personel | `app.servisapp.crew`   | `apps/crew/eas.json`   |

Sürüm `0.0.0` iken mağazaya çıkılmaz. `min_supported_app_version` ile kilitlenen
sürüm, mağazadaki zorunlu güncelleme metniyle aynı semver olmalıdır.

## EAS

1. `eas init` her uygulama dizininde (projectId buraya yazılır, git'e secret
   sokulmaz).
2. **Ortam değişkenlerini EAS'a tanımla** — aşağıdaki tablo. Profiller
   `eas.json` içinde `"environment"` ile EAS ortamına bağlıdır; değerler EAS
   panelinde (ya da `eas env:create`) tutulur, repoya girmez.
3. `eas build --profile production --platform ios`
4. `eas build --profile production --platform android`
5. `eas submit` — veya Transporter / Play Console.

### Derlemeye gömülen değişkenler (production)

| Değişken                        | Neden zorunlu                          |
| ------------------------------- | -------------------------------------- |
| `EXPO_PUBLIC_API_URL`           | API adresi                             |
| `EXPO_PUBLIC_SUPABASE_URL`      | Auth (veli telefon OTP)                |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Auth publishable anahtar               |
| `EXPO_PUBLIC_EAS_PROJECT_ID`    | Push token kaydı (boşsa kayıt atlanır) |

`EXPO_PUBLIC_DEV_LOGIN` **üretimde tanımlanmaz**.

> Bunlar derleme zamanında paketin içine gömülür; sonradan ayarlanamaz. Eksik
> `EXPO_PUBLIC_API_URL` ile derlenen bir yayın sürümü eskiden sessizce
> `127.0.0.1`'e bakıyor ve kullanıcıya yalnız "internet yok" diyordu. Artık
> ilk istekte `api_unconfigured` hatası verir — yine de gönderim öncesi
> **preview profiliyle derleyip gerçek cihazda giriş yapın.**

## Apple

- Gizlilik beslenmesi: veli uygulamasında arka plan konumu **yok**. Personelde
  sefer sırasında konum; `NSLocationWhenInUse` + `NSLocationAlways` metinleri
  `apps/crew/app.json` içinde.
- Kids Category değil: uygulamayı çocuk indirmez, veli/personel indirir.
- Sign in with Apple: veli telefon OTP, personel e-posta. Apple kuralı hesap
  silme URL'si ister — KVKK silme talebiyle aynı uç.
- Background Modes: personel `location` (sefer ACTIVE). Sefer bitince takip
  durur; inceleme notuna yazın.

## Google Play

- Prominent disclosure: personel arka plan konum için Play politikası.
- Data safety formu: konum, telefon, fotoğraf (opsiyonel rıza).
- Foreground service type `location` (Expo prebuild).

## Gönderilmeyecekler

- `service_role` / pepper / OTP anahtarı istemcide yok.
- DEV_LOGIN üretimde kapalı.
- PrivacyMap şematik harita; inceleme notunda "gerçek yol haritası değil" denir.

## Kapı

Metinler hukukçu onaylı [KVKK](kvkk/README.md) olmadan store listing'e gizlilik
URL'si konmaz. Saha provası ([field-trial.md](field-trial.md)) mağaza
incelemesinden önce 1 araçla biter.
