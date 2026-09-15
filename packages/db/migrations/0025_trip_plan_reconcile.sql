-- Plan değişikliğinin üretilmiş sefere yansıtılması (yeni rota sürümü, sonradan
-- ilan edilen tatil). Sefer anlığını silmek API rolüne açık bir yetki DEĞİLDİR;
-- yalnız bu definer fonksiyon üzerinden ve yalnız başlamamış sefer için yapılır.

create or replace function clear_trip_snapshot(p_trip_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_trip trip%rowtype;
  v_facts integer;
  v_removed integer;
begin
  select * into v_trip
  from trip t
  where t.tenant_id = v_tenant and t.id = p_trip_id
  for update;
  if not found then
    raise exception 'trip_not_found';
  end if;

  -- Başlamış sefer yeniden kurulamaz: yaşanmış gerçek plana yenik düşmez.
  if v_trip.state not in ('PLANNED', 'READY') then
    raise exception 'trip_already_started';
  end if;

  select count(*) into v_facts
  from trip_student ts
  where ts.tenant_id = v_tenant
    and ts.trip_id = p_trip_id
    and ts.state not in ('EXPECTED', 'ABSENT_PLANNED', 'MOVED_OUT');
  if v_facts > 0 then
    raise exception 'trip_has_operational_fact';
  end if;

  -- Uyarı kaydı denetim izidir; silinmez, yalnız silinecek durağa bağı çözülür.
  update critical_change_alert
  set trip_stop_id = null
  where tenant_id = v_tenant and trip_id = p_trip_id and trip_stop_id is not null;

  delete from trip_stop_student
  where tenant_id = v_tenant
    and trip_stop_id in (
      select id from trip_stop where tenant_id = v_tenant and trip_id = p_trip_id
    );

  delete from trip_student
  where tenant_id = v_tenant and trip_id = p_trip_id;

  delete from trip_stop
  where tenant_id = v_tenant and trip_id = p_trip_id;
  get diagnostics v_removed = row_count;

  return v_removed;
end;
$$;

alter function clear_trip_snapshot(uuid) owner to servisapp_definer;
revoke all on function clear_trip_snapshot(uuid) from public;
grant execute on function clear_trip_snapshot(uuid) to servisapp_api, servisapp_worker;

grant select, delete on table trip_stop, trip_student, trip_stop_student to servisapp_definer;
grant select, update on table critical_change_alert to servisapp_definer;

-- Definer genel tenant_isolation listesinde değildir; dokunduğu her tablo için
-- kiracı bariyeri ayrıca tanımlanır (0003 ile aynı gerekçe).
-- 0009 yalnız SELECT verdi; anlığı silmek için DELETE de gerekiyor.
create policy trip_stop_definer_delete on trip_stop
  as permissive for delete
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()));

create policy trip_stop_student_definer_isolation on trip_stop_student
  as permissive for all
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()))
  with check (tenant_id = (select app_tenant_id()));

create policy critical_change_alert_definer_isolation on critical_change_alert
  as permissive for all
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()))
  with check (tenant_id = (select app_tenant_id()));
