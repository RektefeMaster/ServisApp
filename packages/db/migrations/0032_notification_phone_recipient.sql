-- Teslim kodu, çocuğu alacak kişinin telefonuna gider.
--
-- Ürün kararı: farklı teslimatta gidecek kişiyi kayıtlı veli belirler
-- (ad + telefon) ve KOD O NUMARAYA gider. Kodun velide olması "yetki", kodun
-- alıcıda olması "zilyetlik" doğrular; kapıda çocuğu teslim alan kişinin
-- kendisinin doğrulanması gerekir.
--
-- Bunun için bildirim satırı artık üyeliğe DEĞİL, doğrudan bir telefona da
-- adreslenebilir. İkisinden tam olarak biri dolu olmalıdır.

alter table notification
  alter column recipient_membership_id drop not null;

alter table notification
  add column if not exists recipient_phone text;

alter table notification
  drop constraint if exists notification_recipient_target;

alter table notification
  add constraint notification_recipient_target
  check (
    (recipient_membership_id is null) <> (recipient_phone is null)
  );
