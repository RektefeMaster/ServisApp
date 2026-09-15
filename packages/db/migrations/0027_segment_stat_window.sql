-- Segment istatistiğinde gerçek medyan ve p75.
--
-- Eski davranış: median_seconds akan ortalamayla, p75_seconds ise gördüğü en
-- büyük değerle güncelleniyordu. Tek kötü sefer p75'i kalıcı zehirliyor, medyan
-- da ortalamadan ayırt edilemiyordu. Artık son N ölçüm satırda tutulur ve
-- yüzdelikler bu pencereden hesaplanır.
--
-- Eski satırların türetilmiş değerleri güvenilir değil: pencere boş başlar ve
-- ilk yeni ölçümden itibaren doğru dolar.

alter table route_segment_stat
  add column if not exists recent_seconds integer[] not null default '{}';
