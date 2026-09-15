# Mobil arayüz — 13 Eylül 2026

Veli (`apps/parent`) ve personel (`apps/crew`) uygulamaları aynı sade görsel sistemi kullanır. Ana yüzey kırık beyaz, içerik yüzeyleri beyaz, metin ve ana aksiyonlar koyu grafittir. Renkli vurgular yalnız durum ve uyarılarda kullanılır.

## Görsel sistem

- `packages/ui/src/theme.ts`: renkler, tipografi, boşluklar, köşe ve gölge değerleri. Figtree arayüzde, IBM Plex Mono saat/plaka/sayaçlarda kullanılır.
- `Identity.tsx`: native çizilen rota amblemi, marka kilidi, isim baş harfleri, bölüm başlıkları, giriş tanıtımı ve yüzey bileşeni.
- `ActionRow.tsx`: başlık, açıklama ve geçiş işaretiyle günlük işlemleri keşfedilebilir kılar.
- Ana düğmeler en az 56, personel ana işlemi 72, yardımcı kontroller 48 punto yüksekliğindedir. Etiketler satır kırabilir; ekran içeriği geniş ekranlarda 560 puntoyla sınırlanır.
- Form alanlarında belirgin odak durumu ve erişilebilir ad bulunur. Parolada göster/gizle, SMS kodunda otomatik doldurma ve numarayı düzeltme desteklenir.

## Ekranlar

Veli: giriş, davet, ana ekran, öğrenci detayı, canlı takip, katılım bildirimi, farklı teslimat, kalıcı adres talebi ve hesap görünümü. Çıkış hesap ekranında; ana ekran öğrenci durumuna odaklanır. Başarısız yüklemede boş öğrenci durumu gösterilmez ve yeniden deneme sunulur.

Personel: giriş, günün seferleri ve aktif sefer. Son açılan sefer yoksa sıradaki planlı/hazır sefer öne çıkar. Aktif seferde sayaçlar, durak akışı, öğrenci odağı ve sabit işlem alanı ayrılır. Normal biniş sırasında her bekleyen öğrenci için kapanış hatası gösterilmez; yönetici müdahalesi gerektiren uyarılar görünür kalır, öğrenci odağı kalmadığında tüm kapanış engelleri gösterilir. Kapanış ve teslimat kuralları domain katmanında korunur.

Konum görünümü mevcut koordinat yerleşimini kullanır; sokak haritası sağlamaz. Bu nedenle açıkça **şematik** olarak etiketlenmiştir. Yalnız araç ve ilgili öğrencinin durağı gösterilir.

## Doğrulama

- UI, veli ve personel: TypeScript ve ESLint başarılı.
- Her iki uygulama: Expo iOS ve Android Hermes bundle export başarılı. Bu bir mağaza paketi veya cihaz çalıştırma testi değildir.
- Mevcut `crew-focus` ve `trip-state-machine` testleri: 27/27 başarılı.
- Gerçek ekran bileşenlerinin React Native Web önizlemesi: 320 punto genişlikte dokuz veli ve üç personel görünümünde yatay taşma yok. Ana ekranlar 390; girişler ve aktif sefer 320 genişlikte görsel incelendi.
- Katılım seçimi olmadan gönderim kapalı, seçilince açık; altı haneli SMS koduyla giriş açık; numara düzeltme, parola göster/gizle ve öğrenci listesi aç/kapat kontrol edildi.
- Sekiz temel metin/zemin renk çiftinin hesaplanan kontrastı en az 4.5:1. Bu kontrol tüm uygulama için tam erişilebilirlik denetimi sayılmaz.

Önizleme sentetik veri ve taklit API yanıtları kullanır; gerçek oturum, SMS, GPS veya kayıt işlemi yapmaz. Fiziksel cihaz/simülatörde klavye, ekran okuyucu, büyük yazı ve sistem güvenli alan kontrolleri bu çalışmada yapılmadı.

## 14 Eylül — görsel kimlik ve gezinme revizyonu

İlk sürümün fazla sade bulunması üzerine ana ekranların düzeni yeniden ele alındı. Koyu petrol-grafit yüzeyler, ölçülü kum/bronz vurgular, özel SVG servis çizimi ve ortak çizgi ikonları eklendi. Çizim dekoratiftir; gerçek rota veya konum bilgisi sunmaz. SVG sürümü, projedeki Expo'nun desteklediği `15.15.4` ile eşleştirildi.

- Veli: okul kimliği, yolculuk durumu, tahmini süre ve takip aksiyonu tek kartta; alt gezinmede Bugün, Çocuklarım ve Hesabım. Çok çocuklu hesaplarda plan düzenleme önce çocuk seçimine götürür.
- Personel: günlük sefer sayaçları, plaka ve saat içeren sefer kartı, sabah/akşam filtreleri, alt gezinme ve hesap paneli. Sayaçlar API sonuçlarından türetilir; yükleme/hata sırasında bilinmeyen değerler çizgiyle gösterilir.
- Girişler: kompakt resimli marka paneli. Öğrenci detayları, işlem satırları ve personel odak kartı aynı ikon/yüzey sistemini kullanır.
- Doğrulama: iki uygulama ve UI tip/lint kontrolleri; iki uygulama için iOS/Android Expo export; 320 genişlikte 12 görünümün yatay taşma kontrolü; çocuklar sekmesi, sefer filtresi ve hesap paneli etkileşimleri. İkonların web erişilebilirlik niteliğinden kaynaklanan konsol uyarısı düzeltildi.

Fiziksel cihaz ve ekran okuyucu doğrulaması bu revizyonda da yapılmadı. Önizleme sentetik verilerle çalışır.

## 14 Eylül — erişilebilirlik ve gezinme düzeltmeleri

Bu tur görsel yenileme değil, tespit edilen hataların kapatılmasıdır.

- **Android geri tuşu.** İki uygulama da elle yazılmış bir yönlendirici
  kullanıyor ve donanım geri tuşunu yalnız tek bir ekran dinliyordu; diğer her
  yerde tuş **uygulamayı kapatıyordu** — şoför aktif seferin ortasında bile.
  Ortak `useHardwareBack` kancası eklendi ve bütün ekranlara bağlandı. Kök
  ekranlarda tuş uygulamadan çıkar; alt sekme, açık panel, onay kutusu ya da
  çok adımlı form varsa önce onlar geri alınır.
- **Alt gezinme çubuğu.** Ekranın yatay dolgusu içinde çizildiği için iki yanda
  20 punto içeride kalıyordu; ayrıca ev göstergesi olan telefonlarda taban
  dolgusu yoktu. `Screen` artık ayrı bir `nav` yuvası veriyor, çubuk güvenli
  alan kadar büyüyor. "Hesabım" sekme değil düğme rolü alıyor; çubuk `tablist`.
- **Dinamik yazı boyutu.** Gövde, açıklama ve etiketler kullanıcının ayarını tam
  takip eder. Yalnız büyük gösterim tipine tavan kondu (`fontScaleCaps`):
  sayaç şeridi ve bilet kartı 3 kat büyütmede yatayda kırılıyordu.
- **Ekran okuyucu.** Dekoratif ikonlar üç platformda da gizlendi (`aria-hidden`
  yalnız web'de işliyordu, native'de her simge tek tek okunuyordu). Form alanı
  hatası artık alanın kendisine bağlı ve canlı bölge olarak duyuruluyor; liste
  satırındaki "›" süslemesi okunmuyor.
- **Kontrast.** Palet hesaplandı: yardımcı metin rengi `#68716A`, renkli
  yüzeylerde 4.25–4.40:1 ile AA eşiğinin altında kalıyordu (kart açıklamaları,
  uyarı gövdeleri). `#5D665F` yapıldı — paletteki her zeminde en az 5:1. Form
  alanı kenarı için ayrı bir ton eklendi (`field`): alanın sınırını yalnız
  kenarlık gösterdiği için WCAG 1.4.11 gereği 3:1 ister, eski `line` tonu
  beyazda 1.27:1 idi.

**Doğrulama:** tip kontrolü, ESLint ve biçim kontrolü başarılı; kontrast
oranları hesaplanarak doğrulandı. Bu turda da fiziksel cihaz, simülatör ve
ekran okuyucu denemesi YAPILMADI — Android geri tuşu davranışı ve güvenli alan
dolgusu cihazda ayrıca doğrulanmalıdır.

## Yönetim paneli — 14 Eylül düzeltmeleri

- **Dar ekran.** Yan sütun sabit 224 punto genişlikteydi ve hiç gizlenmiyordu:
  telefonda içeriğe 150 punto kalıyordu. `lg` altında yan sütun kapanır, üstte
  "Menü" düğmesi gelir; bölüm seçilince menü kendiliğinden kapanır.
- **Şirket seçimi.** Birden çok şirkette yöneticilik yapan kişi ilk şirkete
  kilitleniyordu; API ucu (`/api/session/tenant`, rolü doğrular) vardı ama
  panelde karşılığı yoktu. Yan sütuna şirket seçici eklendi; seçim tam sayfa
  yenilemesiyle uygulanır, ekranda karışık kiracı verisi kalmaz.
- **Türkçe durumlar.** Ekranlar veritabanı enum'larını ham basıyordu — "sabah
  PREPARING", "AUTO_CLOSED", "PENDING_APPROVAL". `lib/labels.ts` sözlüğü
  eklendi; bilinmeyen değer gizlenmez, ham kod görünür kalır.
- **Sekme başlığı.** Her bölüm kendi `layout.tsx`'inde başlığını verir; panel
  sayfaları istemci bileşeni olduğu için hepsi "ServisApp Yönetim" diye
  açılıyordu.
- **Form kontrolleri.** Alanlar 26 punto yüksekliğindeydi ve odak halkası yoktu;
  kenarlık beyaz üstünde 1.58:1 ile alanın sınırını göstermiyordu. Yükseklik
  büyütüldü, görünür odak eklendi, form kenarlığı için 3:1 veren ayrı bir ton
  (`--color-field`) tanımlandı.
- **Sonuç bildirimi.** Kaydet sonrası hata/başarı satırı sessiz bir paragraftı;
  artık `role="alert"` / `role="status"` ile duyuruluyor ve zeminli gösteriliyor.
- **Klavye ve yapı.** "İçeriğe geç" atlama bağlantısı, aktif bağlantıda
  `aria-current="page"`, oturum okunamadığında "Tekrar dene" düğmesi.

**Doğrulama:** panel yerel yığınla (Postgres + API + Next) açıldı; 1024 ve 375
punto genişlikte gezildi. Altı bölümde adsız form kontrolü, adsız düğme,
yinelenen id ve yatay taşma denetimi temiz; sekme başlıkları ve Türkçe durum
etiketleri ekranda doğrulandı; odak halkası görsel olarak kontrol edildi.

## 14 Eylül — simülatörde gerçek uçtan uca prova

Bu tur tasarım değil **saha provası**: iOS Simulator'da (iPhone 16) veli ve
personel uygulamaları, tarayıcıda yönetim paneli ve yerel Postgres ile birlikte
çalıştırıldı. Veri, doğrudan SQL ile değil ADMIN API'sinden kuruldu; bütün
adımlar gerçek uçlara gitti. Üç sefer baştan sona yürütüldü:

1. **Sabah (okula gidiş).** Bir çocuk için veli "bugün binmeyecek" bildirdi,
   diğeri bindi ve okulda teslim edildi.
2. **Akşam (eve dönüş, kayıtlı adres).** İki çocuk okulda bindirildi, kendi
   duraklarında teslim edildi, araç boş onaylanıp sefer kapatıldı.
3. **Akşam ikinci vardiya (farklı adrese teslim).** Veli uygulamadan "farklı
   teslimat" talebi gönderdi, yönetici panelden onayladı, kod alıcının
   numarasına kuyruğa girdi, şoför kapıda kodu girdi ve teslim tamamlandı.

Denetim izi veritabanından doğrulandı: `TRIP_GENERATED → CREW_ASSIGNED →
PLAN_TEMP_DELIVERY → TRIP_READY → VEHICLE_CHECK_BEFORE → TRIP_STARTED →
STUDENT_STATE(EXPECTED→ON_BOARD) → DELIVERY_OTP_VERIFIED →
STUDENT_STATE(ON_BOARD→DELIVERED) → VEHICLE_CHECK_AFTER → TRIP_COMPLETED`.

### Provanın açığa çıkardığı hatalar

- **Kod doğrulama, seferi başlatmayı engelliyordu.** Günün herhangi bir farklı
  teslimatı varsa şeridin tek düğmesi "Kodu doğrula" oluyordu — sefer daha
  başlamamışken bile. Şoför araç kontrolünü yapamıyor, seferi başlatamıyordu;
  üstelik kod, alıcı kapıda değilken okul önünde soruluyor, yanlış denemeler
  hakkı tüketip talebi kilitleyebiliyordu. Artık sefer düzeyindeki adım önce
  gelir; kod yalnız çocuk araçtayken, kendi kapısında sorulur.
- **Yanlış kod sessizdi.** Hata metni açık sayfanın altına yazılıyordu, yani
  hiç görünmüyordu: şoför "Doğrula"ya basıyor, ekranda hiçbir şey olmuyor, oysa
  sunucu "Kod hatalı" demiş ve hakkı bir azalmıştı. Beş sessiz denemede talep
  kilitlenirdi. Hata artık kodun sorulduğu yerde görünür, alan temizlenir.
- **Kalkıştan sonra atanan şoför kapıda kilitleniyordu.** Sefer listesi doğru
  pencereyi kullanıyordu (`greatest(now, plannedDepartureAt)`), ama teslim kodu
  ve kritik uyarı onayı yalnız planlanan kalkışa bakıyordu. Yedek şoför seferi
  açıp çocuğu bindirebiliyor, ama kodu doğrulayamıyordu (404). İki uç aynı
  pencereyi kullanır oldu.
- **Akşam okul kapısında sayaç "0/1" değil "0/0" idi.** Sayaç durak
  ÜYELİĞİNDEN türetiliyordu; akşam öğrenciler iniş duraklarına bağlıdır, okul
  kapısında üyelikleri yoktur. Günün en kalabalık kapısında ilerleme geri
  bildirimi yoktu. `stopWorkload` eklendi: kapının gerçekten işlediği öğrenciler
  sayılır, bugün binmeyecek çocuk hiçbir kapıda sayılmaz.
- **Kime teslim edileceği ekranda yazmıyordu.** GUARDIAN_REQUIRED + ev
  tesliminde tek yetkili varsa uygulama onu sessizce seçip kayda geçiriyordu;
  şoför kapıdaki kişinin yetkili olup olmadığını bilmeden onaylıyor, olay
  kaydına hiç görmediği bir isim yazılıyordu. İsim artık odak kartında.
- **Onaylanamayacak talep kaydediliyordu.** Çocuk araca bindikten sonra veli
  "farklı teslimat" gönderebiliyordu: sapması küçükse anında hata, büyükse
  sessizce "onay bekliyor" olarak kaydediliyordu. Veli kod beklerken yönetici
  onaylayamadığı bir satırla kalıyordu. Talep artık yazılmadan önce reddedilir;
  onay anındaki yarış için mesaj da ne yapılacağını söyler.
- **Veliye "Yaklaşık 720 dk" yazıyordu.** Araç rotanın yüzlerce km dışında bir
  koordinat bildirdiğinde ETA on iki saatlik ufka KIRPILIYOR, sonra o kırpılmış
  değer güven puanı 0.75 ile ekrana çıkıyordu. Ufkun dışındaki ETA artık
  gösterilmez; ayrıca konum canlı değilken ETA da yazılmaz (araç işaretçisi
  gizlenirken yanında eski bir süre durmaya devam ediyordu).
- **Çocuk ekranı "Sabah · Planlı" diyordu.** Yalnız akşam servisine kayıtlı
  çocuğun velisi hiç gelmeyecek bir araç bekliyordu; ekran plan durumunu
  sormuyor, "Planlı" varsayıyordu. Günlük plan yanıtı artık segment durumunu
  taşır ("Servis yok", "Hazırlanıyor", "Askıda").
- **Sefer kapanınca ana ekran günün sonucunu unutuyordu.** Çocuk 21:50'de
  teslim edilmiş olsa bile kart gece boyunca "Servis planlı · bugün servis var"
  yazıyordu, çünkü canlı görünüm yalnız ACTIVE sefere bakıyordu. Bugünün
  başlamış son seferi artık `trackingEnded` işaretiyle döner: canlı takip
  açılmaz, sonuç okunur ("Teslim edildi · Akşam · tamamlandı").
- **Adres alanı otomatik düzeltmeye açıktı.** iOS "Bağdat"ı "Baghdad" yaptı; bu
  metni kapıda şoför okuyor. Otomatik düzeltme kapatıldı.

### Doğrulama

- Üç sefer simülatörde elle yürütüldü; her adım ekran görüntüsüyle ve
  veritabanındaki olay kaydıyla karşılaştırıldı.
- Yanlış kod denemesi gerçekten yapıldı: `attempt_count` arttı, kilit sınırına
  (5) dokunulmadı, doğru kodla teslim tamamlandı ve `delivery_override`
  VERIFIED oldu, şifreli kod temizlendi.
- Biçim, derleme, tip kontrolü ve lint temiz; test paketi 459/459 başarılı
  (domain 216, sözleşme 13, db 59, simülatör 6, API 165). Araçtayken yeni
  farklı teslimat talebinin reddi API E2E paketine eklendi.
- **Yapılmayanlar:** fiziksel cihaz, ekran okuyucu ve Android denemesi bu turda
  da yok. SMS sağlayıcısı yerelde tanımlı olmadığı için teslim kodu, ürünün
  kendi şifre çözme yolundan okundu — gerçek SMS gönderimi denenmedi. GPS
  simülatörde gerçek konum üretmediği için canlı takip haritası ve yaklaşma
  bildirimi saha koşullarında doğrulanmadı.
