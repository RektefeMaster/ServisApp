-- Faz 7: plan katmanı (API trip_student UPDATE edemez) + durak bazlı kritik uyarı.

alter table critical_change_alert
  add column if not exists trip_stop_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'critical_change_alert_stop_fk'
  ) then
    alter table critical_change_alert
      add constraint critical_change_alert_stop_fk
      foreign key (tenant_id, trip_stop_id)
      references trip_stop (tenant_id, id);
  end if;
end
$$;

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
    if p_set_state or p_set_delivery_target then
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
