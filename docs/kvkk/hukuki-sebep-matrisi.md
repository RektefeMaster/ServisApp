# Hukuki sebep matrisi (taslak)

**Durum:** TASLAK — hukukçu onayı olmadan sözleşme eki olmaz.

KVKK m.5/m.6. Başka sebep varken açık rıza **alınmaz**. V1 sağlık verisi yok.

| Veri kategorisi | Amaç | Hukuki sebep (taslak) | Saklama | Aktarım |
| --------------- | ---- | --------------------- | ------- | ------- |
| Veli/personel kimlik, telefon | Hesap, davet, OTP SMS | Sözleşmenin ifası (m.5/2-c) | Üyelik + 1 yıl | EU işleyen (Supabase Auth, Netgsm SMS) |
| Öğrenci kimlik, okul, durak, adres | Rota ve sefer planı | Sözleşmenin ifası | Kayıt süresince; ayrılınca profil silinir | EU işleyen |
| Öğrenci fotoğrafı | Personel/veli tanıma | **Açık rıza** (ayrı metin) | Ayrılınca silinir | EU işleyen |
| Teslim politikası, veli ilişkisi | Güvenli teslimat | Sözleşmenin ifası | Kayıt süresince | EU işleyen |
| Sefer + `trip_student` durumu | Operasyon, "araçta çocuk var mı" | Sözleşmenin ifası | Sefer + olay kaydı 1 yıl | EU işleyen |
| Şoför GPS (ACTIVE sefer) | Veliye canlı konum, ETA | Sözleşmenin ifası / meşru menfaat (hukukçu seçer) | Ping 14 gün | EU işleyen |
| OTP hash / ciphertext | Farklı adres teslim doğrulama | Sözleşmenin ifası | Override kilidi süresince; kod düz metin yok | EU, Fastify (pepper secret) |
| Olay kaydı (`event`) | Denetim, uyuşmazlık | Meşru menfaat / kanuni yükümlülük (hukukçu seçer) | 1 yıl; silmede takma kimlik | EU işleyen |
| Cihaz id, epoch, app sürümü | Sahte GPS düşürme, 426 | Sözleşmenin ifası / güvenlik meşru menfaati | Cihaz iptaline kadar | EU işleyen |
| Push token | Sefer bildirimi | **Açık rıza** | Token geçersiz olunca | Expo Push |
| Yönetici erişim izi | "kim hangi adrese baktı" | Meşru menfaat / hesap verebilirlik | 1 yıl | EU işleyen |

VERBİS kaydı otomatik değildir; çalışan sayısı / mali bilanço istisnaları veri
sorumlusu (müşteri) bazında değerlendirilir.

Yurt dışı aktarım: yöntem seçilir (SCC **veya** taahhütname **veya** diğer) —
birbirinin yerine geçmez.
