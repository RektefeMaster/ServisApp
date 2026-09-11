-- Bildirim outbox: gecikmeli veli durumu, geri alma iptali, davet SMS gövdesi.
-- Bindi geri alınırsa boarded_at temizlenir.

alter type notification_status add value if not exists 'CANCELLED';

alter table notification
  add column if not exists hold_until timestamptz,
  add column if not exists source_command_id uuid,
  add column if not exists ref_id uuid;

create index if not exists notification_outbox_due_idx
  on notification (tenant_id, created_at)
  where status = 'QUEUED';

alter table guardian_invite
  add column if not exists token_ciphertext bytea;

alter table invite_sms
  add column if not exists body_ciphertext bytea;

create index if not exists invite_sms_queued_idx
  on invite_sms (tenant_id, created_at)
  where status = 'QUEUED';

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
  v_clear_boarded boolean;
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
  v_clear_boarded := p_to_state in ('EXPECTED', 'NO_SHOW', 'ABSENT_PLANNED');

  update trip_student
  set
    state = p_to_state,
    state_seq = v_new_seq,
    state_changed_at = now(),
    boarded_at = case
      when p_to_state = 'ON_BOARD' then now()
      when v_clear_boarded then null
      else boarded_at
    end,
    boarded_lat = case
      when p_to_state = 'ON_BOARD' then p_boarded_lat
      when v_clear_boarded then null
      else boarded_lat
    end,
    boarded_lng = case
      when p_to_state = 'ON_BOARD' then p_boarded_lng
      when v_clear_boarded then null
      else boarded_lng
    end,
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
