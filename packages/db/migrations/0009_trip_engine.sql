-- Faz 4 sefer motoru: kiracı listesi (worker), öğrenci CAS (definer).
-- servisapp_api trip_student UPDATE edemez; SELECT FOR UPDATE da UPDATE ister.

grant select on table tenant to servisapp_definer;
grant select on table trip_stop to servisapp_definer;

create policy tenant_definer_select on tenant
  as permissive for select
  to servisapp_definer
  using (true);

create policy trip_stop_definer_isolation on trip_stop
  as permissive for select
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()));

create or replace function list_tenants_for_jobs()
returns table(id uuid, timezone text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.timezone from tenant t;
$$;

create or replace function lock_trip_student_for_command(p_trip_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_trip_id uuid;
  v_trip trip%rowtype;
  v_student trip_student%rowtype;
begin
  select ts.trip_id into v_trip_id
  from trip_student ts
  where ts.tenant_id = v_tenant and ts.id = p_trip_student_id;
  if not found then
    raise exception 'trip_student_not_found';
  end if;

  select * into v_trip
  from trip t
  where t.tenant_id = v_tenant and t.id = v_trip_id
  for share;
  if not found then
    raise exception 'trip_not_found';
  end if;

  select * into v_student
  from trip_student ts
  where ts.tenant_id = v_tenant and ts.id = p_trip_student_id
  for update;
  if not found then
    raise exception 'trip_student_not_found';
  end if;

  return jsonb_build_object(
    'tripId', v_trip.id,
    'tripState', v_trip.state,
    'vehicleId', v_trip.current_vehicle_id,
    'state', v_student.state,
    'stateSeq', v_student.state_seq,
    'deliveryTarget', v_student.delivery_target,
    'deliveryVerified', v_student.delivery_verified_at is not null,
    'studentId', v_student.student_id
  );
end;
$$;

create or replace function apply_student_state_transition(
  p_trip_student_id uuid,
  p_expected_state_seq integer,
  p_from_state student_state,
  p_to_state student_state,
  p_boarded_lat double precision default null,
  p_boarded_lng double precision default null,
  p_actual_stop_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_trip_id uuid;
  v_trip trip%rowtype;
  v_student trip_student%rowtype;
  v_new_seq integer;
begin
  select ts.trip_id into v_trip_id
  from trip_student ts
  where ts.tenant_id = v_tenant and ts.id = p_trip_student_id;
  if not found then
    raise exception 'trip_student_not_found';
  end if;

  select * into v_trip
  from trip t
  where t.tenant_id = v_tenant and t.id = v_trip_id
  for share;
  if not found then
    raise exception 'trip_not_found';
  end if;

  select * into v_student
  from trip_student ts
  where ts.tenant_id = v_tenant and ts.id = p_trip_student_id
  for update;
  if not found then
    raise exception 'trip_student_not_found';
  end if;

  if v_student.state_seq is distinct from p_expected_state_seq
     or v_student.state is distinct from p_from_state then
    update trip_student
    set needs_review = true
    where tenant_id = v_tenant and id = p_trip_student_id;
    return jsonb_build_object(
      'applied', false,
      'reason', 'conflict',
      'state', v_student.state,
      'stateSeq', v_student.state_seq,
      'tripState', v_trip.state
    );
  end if;

  if p_actual_stop_id is not null then
    if not exists (
      select 1
      from trip_stop s
      where s.tenant_id = v_tenant
        and s.id = p_actual_stop_id
        and s.trip_id = v_student.trip_id
    ) then
      raise exception 'trip_stop_not_on_trip';
    end if;
  end if;

  v_new_seq := v_student.state_seq + 1;

  update trip_student
  set
    state = p_to_state,
    state_seq = v_new_seq,
    state_changed_at = now(),
    boarded_at = case when p_to_state = 'ON_BOARD' then now() else boarded_at end,
    boarded_lat = case when p_to_state = 'ON_BOARD' then p_boarded_lat else boarded_lat end,
    boarded_lng = case when p_to_state = 'ON_BOARD' then p_boarded_lng else boarded_lng end,
    actual_stop_id = coalesce(p_actual_stop_id, actual_stop_id),
    delivery_method = case
      when p_to_state in ('DELIVERED', 'DELIVERED_LATE')
           and delivery_target = 'HOME'
           and delivery_method is null
        then 'HOME_NO_CODE'::delivery_method
      else delivery_method
    end
  where tenant_id = v_tenant and id = p_trip_student_id;
  if not found then
    raise exception 'trip_student_transition_failed';
  end if;

  return jsonb_build_object(
    'applied', true,
    'state', p_to_state,
    'stateSeq', v_new_seq,
    'tripState', v_trip.state
  );
end;
$$;

revoke all on function list_tenants_for_jobs() from public;
revoke all on function lock_trip_student_for_command(uuid) from public;
revoke all on function apply_student_state_transition(
  uuid, integer, student_state, student_state, double precision, double precision, uuid
) from public;

alter function list_tenants_for_jobs() owner to servisapp_definer;
alter function lock_trip_student_for_command(uuid) owner to servisapp_definer;
alter function apply_student_state_transition(
  uuid, integer, student_state, student_state, double precision, double precision, uuid
) owner to servisapp_definer;

grant execute on function list_tenants_for_jobs() to servisapp_worker;
grant execute on function lock_trip_student_for_command(uuid) to servisapp_api, servisapp_worker;
grant execute on function apply_student_state_transition(
  uuid, integer, student_state, student_state, double precision, double precision, uuid
) to servisapp_api, servisapp_worker;
