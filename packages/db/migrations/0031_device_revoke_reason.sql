-- Cihaz iptalinin sebebi.
--
-- Personel SUSPENDED yapılınca cihazları iptal ediliyor, ama sonradan ACTIVE
-- yapıldığında iptal kalkmıyordu. Cihaz kimliği telefonun SecureStore'unda
-- sabit olduğu için kişi "Bu cihaz iptal edilmiş" ekranında kalıcı olarak
-- kilitleniyordu. Artık üyelik kaynaklı iptal, üyelik geri açılınca kalkar;
-- yöneticinin tek tek iptal ettiği telefon kapalı kalır.

alter table device
  add column if not exists revoked_reason text;

update device
set revoked_reason = 'ADMIN'
where revoked_at is not null and revoked_reason is null;
