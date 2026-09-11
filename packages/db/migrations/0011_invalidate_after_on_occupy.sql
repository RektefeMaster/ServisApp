-- Sefer sonu boş onayı, çocuk tekrar araca bindikten sonra yalan olur.
-- unique(phase) ikinci AFTER yazdırmaz; bu yüzden onay bayrağı düşer, personel yeniden tarar.

grant update on table trip_vehicle_check to servisapp_definer;

drop policy if exists trip_vehicle_check_definer_isolation on trip_vehicle_check;
create policy trip_vehicle_check_definer_isolation on trip_vehicle_check
  as permissive for all
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()))
  with check (tenant_id = (select app_tenant_id()));

create or replace function invalidate_after_check_when_occupied()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.state in ('ON_BOARD', 'DELIVERY_FAILED')
     and old.state is distinct from new.state then
    perform set_config('app.tenant_id', new.tenant_id::text, true);
    update trip_vehicle_check
    set vehicle_empty_confirmed = false
    where tenant_id = new.tenant_id
      and trip_id = new.trip_id
      and phase = 'AFTER'
      and vehicle_empty_confirmed is true;
  end if;
  return new;
end;
$$;

revoke all on function invalidate_after_check_when_occupied() from public;
alter function invalidate_after_check_when_occupied() owner to servisapp_definer;
grant execute on function invalidate_after_check_when_occupied()
  to servisapp_api, servisapp_worker, servisapp_definer;

drop trigger if exists trip_student_invalidate_after on trip_student;
create trigger trip_student_invalidate_after
  after update of state on trip_student
  for each row
  execute function invalidate_after_check_when_occupied();
