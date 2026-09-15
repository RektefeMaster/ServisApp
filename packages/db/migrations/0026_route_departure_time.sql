-- Rota kendi kalkış saatini taşır. Önceden bütün sabah seferleri 07:00, bütün
-- akşam seferleri 16:00 kabul ediliyordu; gerçek bir servis şirketinde ikinci
-- vardiya 06:30, uzak mahalle 07:10 kalkar. plannedDepartureAt yalnız ekranda
-- değil trafik baseline'ı, personel atama geçerliliği ve otomatik kapanışta da
-- kullanılıyor — bu yüzden yetkili alan rotanın kendisinde olmalı.

alter table route
  add column if not exists departure_local_time text;

update route
set departure_local_time = case when segment = 'MORNING' then '07:00' else '16:00' end
where departure_local_time is null;

alter table route
  alter column departure_local_time set not null;

alter table route
  drop constraint if exists route_departure_local_time;

alter table route
  add constraint route_departure_local_time
  check (departure_local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
