-- Outbox "claim → gönder → sonuçlandır" deseni.
--
-- Önceki hâlde SMS/push sağlayıcısına yapılan HTTP çağrısı, satırları FOR UPDATE
-- ile kilitleyen transaction'ın İÇİNDE yapılıyordu. Sağlayıcı 4 saniye yavaşlarsa
-- DB transaction'ı da 4 saniye açık kalıyor; 50'lik partide kilitler ve bağlantı
-- boşuna işgal ediliyordu. Artık satır kısa bir transaction'da "claim" edilir,
-- gönderim transaction dışında yapılır, sonuç ikinci kısa transaction'da yazılır.
--
-- claimed_at aynı zamanda çöken worker'ın kurtarma noktasıdır: eski claim
-- serbest bırakılır.

alter table notification
  add column if not exists claimed_at timestamptz;

alter table invite_sms
  add column if not exists claimed_at timestamptz;

create index if not exists notification_claim_idx
  on notification (tenant_id, status, claimed_at);

create index if not exists invite_sms_claim_idx
  on invite_sms (tenant_id, status, claimed_at);
