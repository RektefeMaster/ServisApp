import { config, locales } from 'zod';

/**
 * Doğrulama hataları Türkçe olur.
 *
 * Şemaların çoğu kendi mesajını yazmıyor; yazmayanlarda zod'un İngilizce
 * varsayılanı kullanıcıya olduğu gibi çıkıyordu. Sunucu `issues[0].message`'ı
 * doğrudan yanıta koyduğu için şoför ekranında "Invalid email address",
 * yönetici panelinde "Invalid input: expected string, received undefined"
 * görünüyordu — ürün tek dilli ve bu metinler son kullanıcıya gidiyor.
 *
 * Tek yerden ayarlanır: sözleşme paketi hem API'nin hem üç istemcinin ortak
 * girişidir, bu yüzden hepsi aynı dili konuşur. Alan bazlı özel mesajlar
 * (`phoneE164` gibi) bu ayarın üstünde kalır.
 */
config(locales.tr());
