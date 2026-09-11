# Aydınlatma metni (taslak)

**Bu metin açık rıza değildir.** KVKK Kurulu 18.02.2026 / 2026-347: aydınlatma
ile rıza iç içe yazılamaz. Onay kutusu bu sayfada yoktur.

**Durum:** TASLAK — hukukçu onayı olmadan uygulamada gösterilmez.

## Veri sorumlusu

Okul servisi işleten şirket (kiracı / `tenant`). ServisApp yazılımı veri
işleyendir. Müşteri sözleşmesine işleyen maddeleri ayrıca girer.

## İşlenen veriler (V1)

- Kimlik: ad soyad, telefon, e-posta (personel/yönetici)
- Öğrenci: ad, okul, fotoğraf (opsiyonel), durak/adres, teslim politikası
- Veli ilişkisi: hangi çocuğa bakma yetkisi
- Sefer: araç plakası, personel ataması, öğrenci bindi/binmedi/teslim durumu
- Konum: şoför cihazının GPS'i **yalnız sefer ACTIVE iken**
- Farklı teslimat: geçici adres, OTP doğrulama kaydı (kodun kendisi saklanmaz;
  hash/ciphertext sunucuda)
- Olay kaydı: kim, ne zaman, hangi sefer/öğrenci, önceki/sonraki durum
- Cihaz: platform, uygulama sürümü, konum oturum epoch'u

Sağlık verisi, not, devamsızlık gerekçesi, yüz biyometrisi **toplanmaz**.

## Amaçlar

1. Sözleşmeye konu öğrenci taşıma hizmetini yürütmek
2. Veliye sefer sırasında aracın konumunu ve teslim durumunu göstermek
3. Güvenli teslimat (kayıtlı adres / doğrulanmış farklı adres)
4. Uyuşmazlık ve kaza sonrası denetim izi
5. Güvenlik: eski uygulama sürümünü reddetmek, sahte konum oturumunu düşürmek

## Hukuki sebepler

Her kategori için sebep [matriste](./hukuki-sebep-matrisi.md) tek satırdır.
Sözleşmenin ifası veya kanuni yükümlülük varken ayrıca açık rıza alınmaz.

## Aktarım

Sunucu Avrupa'dadır (Supabase + Fly EU). Uygun güvence yöntemi (standart sözleşme
maddeleri / taahhütname — bunlar eşanlamlı değildir) hukukçu seçimiyle uygulanır.

## Saklama

- GPS ping: 14 gün
- Olay kaydı: 1 yıl (silme talebinde takma kimlik)
- Öğrenci fotoğrafı: öğrenci ayrılınca silinir
- Profil: silme talebinde kaldırılır

## Haklar

KVKK m.11: öğrenme, düzeltme, silme, itiraz. Başvuru veri sorumlusuna yapılır.
Şoför, öğrencinin "hayat hikâyesini" görmez; ekranda ad, fotoğraf, durak, teslim
bilgisi ve bir veli telefonu vardır.

## Konum

Şoför konumu sefer bitince toplanmaz; cihaza takibi durdur komutu gider. Yönetici
canlı konum yan menüde ayrı bir harita ürünü değildir; sefer detayındadır.
