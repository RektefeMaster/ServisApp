-- Sefer grafiğinin DB tarafından korunan bütünlüğü.
--
-- Uygulama şu an doğru yazıyor; ama bu şemanın felsefesi "DB invariantı uygulama
-- hatasına karşı da korusun". Aşağıdaki üç ilişki yalnız uygulama koduna
-- güveniyordu:
--   1. trip_student.expected_stop_id / actual_stop_id, ÖĞRENCİNİN KENDİ seferinin
--      durağı olmak zorunda değildi — teoride A seferindeki öğrenci B seferinin
--      durağına bağlanabilirdi.
--   2. trip.route_version_id, trip.route_id ile aynı rotaya ait olmak zorunda
--      değildi.
--   3. Bir sefere aynı anda iki açık şoför (veya iki açık araç) ataması
--      yazılabiliyordu; index vardı ama unique değildi.

-- 1) Öğrencinin durağı kendi seferinin durağıdır.
alter table trip_stop
  drop constraint if exists trip_stop_trip_row_unique;
alter table trip_stop
  add constraint trip_stop_trip_row_unique unique (tenant_id, trip_id, id);

update trip_student ts
set expected_stop_id = null
where expected_stop_id is not null
  and not exists (
    select 1 from trip_stop s
    where s.tenant_id = ts.tenant_id and s.id = ts.expected_stop_id and s.trip_id = ts.trip_id
  );

update trip_student ts
set actual_stop_id = null
where actual_stop_id is not null
  and not exists (
    select 1 from trip_stop s
    where s.tenant_id = ts.tenant_id and s.id = ts.actual_stop_id and s.trip_id = ts.trip_id
  );

alter table trip_student
  drop constraint if exists trip_student_expected_stop_same_trip_fk;
alter table trip_student
  add constraint trip_student_expected_stop_same_trip_fk
  foreign key (tenant_id, trip_id, expected_stop_id)
  references trip_stop (tenant_id, trip_id, id);

alter table trip_student
  drop constraint if exists trip_student_actual_stop_same_trip_fk;
alter table trip_student
  add constraint trip_student_actual_stop_same_trip_fk
  foreign key (tenant_id, trip_id, actual_stop_id)
  references trip_stop (tenant_id, trip_id, id);

-- 2) Seferin sürümü, seferin rotasının sürümüdür.
alter table route_version
  drop constraint if exists route_version_route_row_unique;
alter table route_version
  add constraint route_version_route_row_unique unique (tenant_id, route_id, id);

alter table trip
  drop constraint if exists trip_route_version_same_route_fk;
alter table trip
  add constraint trip_route_version_same_route_fk
  foreign key (tenant_id, route_id, route_version_id)
  references route_version (tenant_id, route_id, id);

-- 3) Bir seferde bir rol için tek açık mürettebat ataması, tek açık araç ataması.
with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, trip_id, role
      order by valid_from desc, id desc
    ) as rn,
    max(valid_from) over (partition by tenant_id, trip_id, role) as newest_from
  from trip_crew_assignment
  where valid_to is null
)
update trip_crew_assignment a
set valid_to = greatest(a.valid_from, ranked.newest_from)
from ranked
where a.id = ranked.id and ranked.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, trip_id
      order by valid_from desc, id desc
    ) as rn,
    max(valid_from) over (partition by tenant_id, trip_id) as newest_from
  from trip_vehicle_assignment
  where valid_to is null
)
update trip_vehicle_assignment a
set valid_to = greatest(a.valid_from, ranked.newest_from)
from ranked
where a.id = ranked.id and ranked.rn > 1;

drop index if exists trip_crew_assignment_open_idx;
create unique index if not exists trip_crew_assignment_open_idx
  on trip_crew_assignment (tenant_id, trip_id, role)
  where valid_to is null;

drop index if exists trip_vehicle_assignment_open_idx;
create unique index if not exists trip_vehicle_assignment_open_idx
  on trip_vehicle_assignment (tenant_id, trip_id)
  where valid_to is null;
