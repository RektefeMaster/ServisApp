-- Bir araçta bir rol için tek açık kalıcı atama.
--
-- Uygulama eskiyi kapatmadan yenisini açabiliyordu; sonuç, aynı minibüs için
-- valid_to'su NULL üç şoför satırıydı. Sefer üretimi en yenisini seçtiği için
-- sorun görünmüyor, ama en son personel askıya alınınca yıllar önceki atama
-- yeniden "geçerli" hâle geliyordu.

-- Çakışan açık satırları en yenisi kalacak şekilde kapat.
with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, vehicle_id, role
      order by valid_from desc, id desc
    ) as rn,
    max(valid_from) over (partition by tenant_id, vehicle_id, role) as newest_from
  from staff_assignment
  where valid_to is null
)
update staff_assignment sa
set valid_to = greatest(sa.valid_from, ranked.newest_from)
from ranked
where sa.id = ranked.id and ranked.rn > 1;

create unique index if not exists staff_assignment_open_unique
  on staff_assignment (tenant_id, vehicle_id, role)
  where valid_to is null;
