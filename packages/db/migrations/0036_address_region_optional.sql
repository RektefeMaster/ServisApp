-- İl ve ilçe zorunlu değildir.
--
-- Bu iki alan yalnız görüntü bilgisidir; hiçbir kural, sefer üretimi ya da
-- yetki kararı onlara bakmaz. Zorunlu oldukları için veli tarafından pinlenen
-- adreslerde (farklı teslimat, adres değişikliği talebi) uygulama sabit değer
-- yazıyordu: `il = 'İstanbul'`, `ilce = 'Kadıköy'`. Ürün Kadıköy dışına
-- çıktığında bu, sessizce yanlış veri üretmek demekti — ve "bilinmiyor" ile
-- "Kadıköy" arasındaki farkı geri kazanmanın yolu yoktu.
--
-- Yönetici panelindeki adres formu iki alanı da doldurmaya devam eder; veli
-- akışları artık uydurmak yerine boş bırakır.

alter table address alter column il drop not null;
alter table address alter column ilce drop not null;
