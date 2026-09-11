# Saha provası

SPEC §13: yayın öncesi **1 araç × 3 gün** gerçek sefer. Simülatör bunun yerine
geçmez.

## Önkoşul

- Restore 1–3 maddesi yeşil (`packages/db` restore testi)
- Kill switch'ler kapalı (`kill_gps/otp/realtime = false`)
- Personel ve veli, mağaza içi test (TestFlight / internal track) veya EAS
  development client
- Pilot rota: gerçek öğrenci listesi, gerçek veliler, yazılı okul/veli onayı

## 3 gün

Her gün sabah + akşam:

1. Personel seferi `READY` → `ACTIVE` açar; hostes varsa ikisi de atanmış.
2. Bindi / binmedi / teslim (akşam OTP varsa) gerçek duraklarda.
3. En az bir gün: uçak modu 5 dk → offline kuyruk → senkron.
4. En az bir gün: uygulamayı öldürüp aç → "devam eden sefer".
5. En az bir kez: GPS'i kapat-aç → watchdog metni, sefer durmaz.
6. İkinci cihazdan GPS (eski telefon) → epoch reddi, canlı konum zıplamaz.
7. Veli uygulamasında canlı konum; şematik / gizlilik filtresi.
8. Yönetici: Bugün öncelikler, sefer detay canlı, Olaylar CSV.

## Kayıt

Gün / sefer / ne bozuldu / ekran görüntüsü **olmadan** prova kapanmaz. Çocuk
yüzü ve adres CSV'ye girmez (olay CSV zaten PII taşımaz).

## Çıkış kapısı

Üç günün sonunda:

- Hiçbir sefer `ON_BOARD` ile kapanmadı
- TEMP teslim doğrulamasız tamamlanmadı
- Veli "servis gelmedi" şikâyeti `trip_id` ile olay kaydında duruyor
- Personel 426 almadan çalıştı

Bundan sonra [mağaza](store-submission.md).
