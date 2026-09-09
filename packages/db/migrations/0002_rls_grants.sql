-- RLS ikinci bariyerdir: servisapp_api / servisapp_worker BYPASSRLS taşımaz.
-- FORCE ROW LEVEL SECURITY tablo sahibini de (superuser hariç) bağlar.
-- set_config(..., true) transaction bitince GUC'u boş string bırakır; bu yüzden
-- eksik bağlamı app_tenant_id() açıkça reddeder.

create or replace function app_tenant_id()
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v text := current_setting('app.tenant_id', true);
begin
  if v is null or v = '' then
    raise exception 'app.tenant_id is not set';
  end if;
  return v::uuid;
end;
$$;

grant execute on function app_tenant_id() to servisapp_api, servisapp_worker, servisapp_definer;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenant',
    'identity',
    'tenant_membership',
    'membership_role',
    'device',
    'address',
    'stop',
    'school',
    'vehicle',
    'staff_assignment',
    'student',
    'student_guardian',
    'student_address',
    'route',
    'route_version',
    'route_stop',
    'route_stop_student',
    'school_calendar_day',
    'stop_travel_time_cache',
    'route_segment_stat',
    'trip',
    'trip_stop',
    'trip_stop_student',
    'delivery_override',
    'trip_student',
    'trip_vehicle_assignment',
    'trip_crew_assignment',
    'trip_vehicle_check',
    'ride_exception',
    'student_trip_move',
    'address_change_request',
    'vehicle_current_location',
    'vehicle_location_ping',
    'critical_change_alert',
    'critical_change_ack',
    'notification',
    'event',
    'command_receipt',
    'pending_command_dependency'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end
$$;

create policy tenant_self on tenant
  as permissive for all
  to servisapp_api, servisapp_worker
  using (id = (select app_tenant_id()))
  with check (id = (select app_tenant_id()));

create policy identity_visible_via_membership on identity
  as permissive for select
  to servisapp_api, servisapp_worker
  using (
    exists (
      select 1 from tenant_membership tm
      where tm.identity_id = identity.id
        and tm.tenant_id = (select app_tenant_id())
    )
  );

create policy identity_insert on identity
  as permissive for insert
  to servisapp_api, servisapp_worker
  with check (true);

create policy identity_update_via_membership on identity
  as permissive for update
  to servisapp_api, servisapp_worker
  using (
    exists (
      select 1 from tenant_membership tm
      where tm.identity_id = identity.id
        and tm.tenant_id = (select app_tenant_id())
    )
  )
  with check (true);

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenant_membership',
    'membership_role',
    'device',
    'address',
    'stop',
    'school',
    'vehicle',
    'staff_assignment',
    'student',
    'student_guardian',
    'student_address',
    'route',
    'route_version',
    'route_stop',
    'route_stop_student',
    'school_calendar_day',
    'stop_travel_time_cache',
    'route_segment_stat',
    'trip',
    'trip_stop',
    'trip_stop_student',
    'delivery_override',
    'trip_student',
    'trip_vehicle_assignment',
    'trip_crew_assignment',
    'trip_vehicle_check',
    'ride_exception',
    'student_trip_move',
    'address_change_request',
    'vehicle_current_location',
    'vehicle_location_ping',
    'critical_change_alert',
    'critical_change_ack',
    'notification',
    'event',
    'command_receipt',
    'pending_command_dependency'
  ]
  loop
    execute format(
      $p$
        create policy %I on %I
          as permissive for all
          to servisapp_api, servisapp_worker
          using (tenant_id = (select app_tenant_id()))
          with check (tenant_id = (select app_tenant_id()))
      $p$,
      t || '_tenant_isolation',
      t
    );
  end loop;
end
$$;

revoke all on schema public from public;
grant usage, create on schema public to postgres;
grant usage, create on schema public to servisapp_definer;
grant usage on schema public to servisapp_api, servisapp_worker;

do $$
declare
  r text;
  write_tables text[] := array[
    'tenant_membership',
    'membership_role',
    'device',
    'stop',
    'school',
    'vehicle',
    'staff_assignment',
    'student',
    'student_guardian',
    'student_address',
    'route',
    'route_version',
    'route_stop',
    'route_stop_student',
    'school_calendar_day',
    'stop_travel_time_cache',
    'route_segment_stat',
    'trip',
    'trip_stop',
    'trip_stop_student',
    'delivery_override',
    'trip_vehicle_assignment',
    'trip_crew_assignment',
    'trip_vehicle_check',
    'ride_exception',
    'student_trip_move',
    'address_change_request',
    'vehicle_current_location',
    'critical_change_alert',
    'critical_change_ack',
    'notification',
    'command_receipt',
    'pending_command_dependency'
  ];
  t text;
begin
  foreach r in array array['servisapp_api', 'servisapp_worker']
  loop
    execute format('grant select, update on table tenant to %I', r);
    execute format('grant select, insert, update on table identity to %I', r);
    execute format('grant select, insert on table address to %I', r);
    execute format('grant select, insert on table event to %I', r);
    execute format('grant select, insert on table vehicle_location_ping to %I', r);
    execute format('grant select, insert on table trip_student to %I', r);
    execute format('grant usage, select on all sequences in schema public to %I', r);

    foreach t in array write_tables
    loop
      execute format('grant select, insert, update on table %I to %I', t, r);
    end loop;
  end loop;
end
$$;

grant select, update on table trip, trip_student, delivery_override to servisapp_definer;
grant select on table trip_vehicle_check to servisapp_definer;
