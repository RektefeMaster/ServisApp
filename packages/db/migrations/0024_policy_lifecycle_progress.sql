-- Adres overlap engeli, OTP expire, AUTO_CLOSED, deviceSeq uniqueness, pending adres tekilliği.
-- lock_trip_student_for_command handover_policy döner.

create extension if not exists btree_gist;

-- Bozuk aralıkları düzelt.
update student_address
set valid_to = valid_from
where valid_to is not null and valid_to < valid_from;

-- Overlap: önceki kaydı later.valid_from - 1 ile kapat (sabit noktaya kadar).
do $$
declare
  changed integer;
begin
  loop
    with ranked as (
      select
        id,
        tenant_id,
        student_id,
        usage,
        valid_from,
        coalesce(valid_to, 'infinity'::date) as valid_to_eff,
        row_number() over (
          partition by tenant_id, student_id, usage
          order by valid_from, id
        ) as rn
      from student_address
    ),
    pairs as (
      select b.id as prev_id, a.valid_from as later_from
      from ranked a
      join ranked b
        on a.tenant_id = b.tenant_id
       and a.student_id = b.student_id
       and a.usage = b.usage
       and a.rn = b.rn + 1
       and a.valid_from <= b.valid_to_eff
    ),
    upd as (
      update student_address sa
      set valid_to = p.later_from - 1
      from pairs p
      where sa.id = p.prev_id
        and (sa.valid_to is null or sa.valid_to >= p.later_from)
      returning sa.id
    )
    select count(*)::integer into changed from upd;
    exit when changed = 0;
  end loop;
end
$$;

update student_address
set valid_to = valid_from
where valid_to is not null and valid_to < valid_from;

alter table student_address
  drop constraint if exists student_address_no_overlap;

alter table student_address
  add constraint student_address_no_overlap
  exclude using gist (
    tenant_id with =,
    student_id with =,
    usage with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  );

create unique index if not exists address_change_one_pending
  on address_change_request (tenant_id, student_id)
  where status = 'PENDING';

create unique index if not exists command_receipt_device_seq_uq
  on command_receipt (tenant_id, device_id, device_seq)
  where device_seq is not null;

-- Definer student okuyabilsin (FORCE RLS); aksi halde handover_policy hep NULL.
grant select on table student to servisapp_definer;
drop policy if exists student_definer_isolation on student;
create policy student_definer_isolation on student
  as permissive for select
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()));

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
  v_policy handover_policy;
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

  select s.handover_policy into v_policy
  from student s
  where s.tenant_id = v_tenant and s.id = v_student.student_id;

  return jsonb_build_object(
    'tripId', v_trip.id,
    'tripState', v_trip.state,
    'vehicleId', v_trip.current_vehicle_id,
    'state', v_student.state,
    'stateSeq', v_student.state_seq,
    'deliveryTarget', v_student.delivery_target,
    'deliveryVerified', v_student.delivery_verified_at is not null,
    'studentId', v_student.student_id,
    'handoverPolicy', coalesce(v_policy, 'GUARDIAN_REQUIRED'::handover_policy)
  );
end;
$$;

-- Tenant GUC olmadan RLS delivery_override/trip satırlarını gizler; kiracı döngüsü zorunlu.
create or replace function expire_stale_delivery_overrides()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_part integer;
  r record;
begin
  for r in select t.id from tenant t order by t.id
  loop
    perform set_config('app.tenant_id', r.id::text, true);
    update delivery_override
    set status = 'EXPIRED', otp_ciphertext = null, otp_hmac = null
    where tenant_id = r.id
      and status = 'ACTIVE'
      and otp_expires_at is not null
      and otp_expires_at <= now();
    get diagnostics v_part = row_count;
    v_count := v_count + v_part;
  end loop;
  return v_count;
end;
$$;

create or replace function auto_close_stale_trips(p_grace_hours integer default 14)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  tenant_row record;
  trip_row record;
  v_blocking integer;
begin
  -- AUTO_CLOSED: COMPLETED ile aynı EXPECTED bloğu yok (0021); yalnız araçtaki çocuk engeller.
  for tenant_row in select t.id from tenant t order by t.id
  loop
    perform set_config('app.tenant_id', tenant_row.id::text, true);
    for trip_row in
      select tr.id
      from trip tr
      where tr.tenant_id = tenant_row.id
        and tr.state = 'ACTIVE'
        and tr.planned_departure_at < now() - make_interval(hours => greatest(p_grace_hours, 1))
      order by tr.id
      for update skip locked
    loop
      select count(*) into v_blocking
      from trip_student ts
      where ts.tenant_id = tenant_row.id
        and ts.trip_id = trip_row.id
        and ts.state in ('ON_BOARD', 'DELIVERY_FAILED');
      if v_blocking > 0 then
        continue;
      end if;
      update trip
      set state = 'AUTO_CLOSED',
          actual_completed_at = coalesce(actual_completed_at, now())
      where id = trip_row.id and tenant_id = tenant_row.id and state = 'ACTIVE';
      if found then
        v_count := v_count + 1;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function expire_stale_delivery_overrides() from public;
revoke all on function auto_close_stale_trips(integer) from public;
grant execute on function expire_stale_delivery_overrides() to servisapp_worker;
grant execute on function auto_close_stale_trips(integer) to servisapp_worker;
alter function expire_stale_delivery_overrides() owner to servisapp_definer;
alter function auto_close_stale_trips(integer) owner to servisapp_definer;
alter function lock_trip_student_for_command(uuid) owner to servisapp_definer;

grant execute on function lock_trip_student_for_command(uuid) to servisapp_api, servisapp_worker;
