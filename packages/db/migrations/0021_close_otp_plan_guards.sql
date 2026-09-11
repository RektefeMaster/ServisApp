-- Sefer kapanış kilidi, OTP kolon koruması, TEMP RETURN_HOME, plan dondurma.

create or replace function prevent_complete_with_students_on_board()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  blocking integer;
begin
  if new.state not in ('COMPLETED', 'ABORTED', 'AUTO_CLOSED') then
    return new;
  end if;
  if old.state is not distinct from new.state then
    return new;
  end if;

  if new.state = 'COMPLETED' then
    if old.state is distinct from 'ACTIVE' then
      raise exception 'trip_not_active';
    end if;
    if not exists (
      select 1
      from trip_vehicle_check c
      where c.tenant_id = new.tenant_id
        and c.trip_id = new.id
        and c.phase = 'AFTER'
        and c.vehicle_empty_confirmed is true
    ) then
      raise exception 'vehicle_sweep_not_confirmed';
    end if;

    select count(*) into blocking
    from trip_student ts
    where ts.tenant_id = new.tenant_id
      and ts.trip_id = new.id
      and ts.state in ('EXPECTED', 'ON_BOARD', 'DELIVERY_FAILED');
    if blocking > 0 then
      raise exception 'students_still_on_trip';
    end if;
    return new;
  end if;

  if new.state = 'ABORTED' then
    select count(*) into blocking
    from trip_student ts
    where ts.tenant_id = new.tenant_id
      and ts.trip_id = new.id
      and ts.state in ('EXPECTED', 'ON_BOARD', 'DELIVERY_FAILED');
    if blocking > 0 then
      raise exception 'students_still_on_trip';
    end if;
    return new;
  end if;

  select count(*) into blocking
  from trip_student ts
  where ts.tenant_id = new.tenant_id
    and ts.trip_id = new.id
    and ts.state in ('ON_BOARD', 'DELIVERY_FAILED');
  if blocking > 0 then
    raise exception 'students_still_on_trip';
  end if;
  return new;
end;
$$;

alter table trip_student
  drop constraint if exists temp_delivery_requires_verification;

alter table trip_student
  add constraint temp_delivery_requires_verification check (
    state not in ('DELIVERED', 'DELIVERED_LATE', 'RETURNED_HOME')
    or delivery_target <> 'TEMP'
    or (delivery_method in ('OTP', 'ADMIN_OVERRIDE') and delivery_verified_at is not null)
  );

create or replace function apply_trip_student_plan(
  p_trip_student_id uuid,
  p_set_state boolean,
  p_next_state student_state,
  p_set_delivery_target boolean,
  p_delivery_target delivery_target,
  p_set_needs_review boolean,
  p_needs_review boolean,
  p_set_receiver boolean,
  p_receiver_name text,
  p_set_dropoff boolean,
  p_dropoff_lat double precision,
  p_dropoff_lng double precision,
  p_dropoff_text text
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
  v_changed boolean := false;
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

  if v_student.state in (
    'ON_BOARD', 'DELIVERED', 'DELIVERY_FAILED', 'DELIVERED_LATE',
    'RETURNED_TO_SCHOOL', 'HANDED_TO_ADMIN', 'RETURNED_HOME'
  ) then
    if p_set_state or p_set_delivery_target or p_set_receiver or p_set_dropoff then
      return jsonb_build_object(
        'applied', false,
        'reason', 'operational_fact',
        'state', v_student.state,
        'stateSeq', v_student.state_seq,
        'tripState', v_trip.state,
        'deliveryTarget', v_student.delivery_target
      );
    end if;
  end if;

  v_new_seq := v_student.state_seq;

  if p_set_state and v_student.state is distinct from p_next_state then
    v_changed := true;
  end if;
  if p_set_delivery_target and v_student.delivery_target is distinct from p_delivery_target then
    v_changed := true;
  end if;
  if p_set_needs_review and v_student.needs_review is distinct from p_needs_review then
    v_changed := true;
  end if;
  if p_set_receiver and v_student.receiver_name is distinct from p_receiver_name then
    v_changed := true;
  end if;
  if p_set_dropoff then
    v_changed := true;
  end if;

  if not v_changed then
    return jsonb_build_object(
      'applied', true,
      'reason', 'noop',
      'state', v_student.state,
      'stateSeq', v_student.state_seq,
      'tripState', v_trip.state,
      'deliveryTarget', v_student.delivery_target
    );
  end if;

  v_new_seq := v_student.state_seq + 1;

  update trip_student
  set
    state = case when p_set_state then p_next_state else state end,
    delivery_target = case when p_set_delivery_target then p_delivery_target else delivery_target end,
    needs_review = case when p_set_needs_review then p_needs_review else needs_review end,
    receiver_name = case when p_set_receiver then p_receiver_name else receiver_name end,
    snapshot_dropoff_lat = case when p_set_dropoff then p_dropoff_lat else snapshot_dropoff_lat end,
    snapshot_dropoff_lng = case when p_set_dropoff then p_dropoff_lng else snapshot_dropoff_lng end,
    snapshot_dropoff_text = case when p_set_dropoff then p_dropoff_text else snapshot_dropoff_text end,
    state_seq = v_new_seq,
    state_changed_at = now()
  where tenant_id = v_tenant and id = p_trip_student_id;
  if not found then
    raise exception 'trip_student_plan_failed';
  end if;

  return jsonb_build_object(
    'applied', true,
    'reason', 'ok',
    'state', case when p_set_state then p_next_state else v_student.state end,
    'stateSeq', v_new_seq,
    'tripState', v_trip.state,
    'deliveryTarget', case when p_set_delivery_target then p_delivery_target else v_student.delivery_target end
  );
end;
$$;

revoke all on function apply_trip_student_plan(
  uuid, boolean, student_state, boolean, delivery_target, boolean, boolean, boolean, text,
  boolean, double precision, double precision, text
) from public;
alter function apply_trip_student_plan(
  uuid, boolean, student_state, boolean, delivery_target, boolean, boolean, boolean, text,
  boolean, double precision, double precision, text
) owner to servisapp_definer;
grant execute on function apply_trip_student_plan(
  uuid, boolean, student_state, boolean, delivery_target, boolean, boolean, boolean, text,
  boolean, double precision, double precision, text
) to servisapp_api;
revoke execute on function apply_trip_student_plan(
  uuid, boolean, student_state, boolean, delivery_target, boolean, boolean, boolean, text,
  boolean, double precision, double precision, text
) from servisapp_worker;

create or replace function protect_otp_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.otp_hmac is not distinct from new.otp_hmac
     and old.otp_ciphertext is not distinct from new.otp_ciphertext then
    return new;
  end if;

  if current_user is not distinct from 'servisapp_definer' then
    return new;
  end if;

  if old.otp_hmac is distinct from new.otp_hmac
     and new.otp_hmac is not null
     and old.otp_hmac is not null then
    raise exception 'otp_columns_are_protected';
  end if;

  if old.otp_ciphertext is distinct from new.otp_ciphertext
     and new.otp_ciphertext is not null
     and old.otp_ciphertext is not null then
    raise exception 'otp_columns_are_protected';
  end if;

  return new;
end;
$$;

drop trigger if exists delivery_override_protect_otp on delivery_override;
create trigger delivery_override_protect_otp
  before update on delivery_override
  for each row
  execute function protect_otp_columns();

revoke all on function protect_otp_columns() from public;
grant execute on function protect_otp_columns() to servisapp_api, servisapp_worker, servisapp_definer;
