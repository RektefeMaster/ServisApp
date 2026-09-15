-- Rota yaşam döngüsü.
--
-- Şemada rotanın "emekli" hâli yoktu: route_version'ın ARCHIVED olması yalnız
-- o sürümün yerini yenisine bıraktığı anlamına gelir, güzergâhın kapandığı
-- anlamına gelmez. Kapanmış bir güzergâhın öğrenci bağları durduğu sürece ufuk
-- onu ileride yeniden değerlendirebiliyordu.
--
-- Emekli rota: yeni sefer üretmez, yeni sürüm yayınlanamaz, henüz başlamamış
-- seferleri uzlaştırma sırasında iptal edilir.

alter table route
  add column if not exists retired_at timestamptz;

create index if not exists route_active_idx
  on route (tenant_id)
  where retired_at is null;
