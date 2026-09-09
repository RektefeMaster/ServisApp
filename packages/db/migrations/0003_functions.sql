-- Invariant fonksiyonları ve tetikleyiciler.
-- Pepper/KMS Postgres'te yoktur; doğrulama Fastify'da, DB yalnız atomikliği sağlar.

create or replace function forbid_append_only_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '%_is_append_only', tg_table_name;
end;
$$;

create trigger event_immutable
  before update or delete on event
  for each row
  execute function forbid_append_only_mutation();

create trigger address_immutable
  before update or delete on address
  for each row
  execute function forbid_append_only_mutation();

create or replace function protect_delivery_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.delivery_method is not null
       or new.delivery_verified_at is not null
       or new.delivery_override_id is not null then
      if current_user is distinct from 'servisapp_definer' then
        raise exception 'delivery_columns_are_protected';
      end if;
    end if;
    return new;
  end if;

  if old.delivery_method is not distinct from new.delivery_method
     and old.delivery_verified_at is not distinct from new.delivery_verified_at
     and old.delivery_override_id is not distinct from new.delivery_override_id
  then
    return new;
  end if;

  if current_user is distinct from 'servisapp_definer' then
    raise exception 'delivery_columns_are_protected';
  end if;
  return new;
end;
$$;

create trigger trip_student_protect_delivery
  before insert or update on trip_student
  for each row
  execute function protect_delivery_columns();

create or replace function prevent_complete_with_students_on_board()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  blocking integer;
begin
  if new.state = 'COMPLETED' and old.state is distinct from 'COMPLETED' then
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
  end if;
  return new;
end;
$$;

create trigger trip_complete_guard
  before update on trip
  for each row
  execute function prevent_complete_with_students_on_board();

create or replace function complete_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_state trip_state;
  v_blocking integer;
begin
  select t.state into v_state
  from trip t
  where t.tenant_id = v_tenant and t.id = p_trip_id
  for update;

  if not found then
    raise exception 'trip_not_found';
  end if;
  if v_state is distinct from 'ACTIVE' then
    raise exception 'trip_not_active';
  end if;

  if not exists (
    select 1
    from trip_vehicle_check c
    where c.tenant_id = v_tenant
      and c.trip_id = p_trip_id
      and c.phase = 'AFTER'
      and c.vehicle_empty_confirmed is true
  ) then
    raise exception 'vehicle_sweep_not_confirmed';
  end if;

  select count(*) into v_blocking
  from trip_student ts
  where ts.tenant_id = v_tenant
    and ts.trip_id = p_trip_id
    and ts.state in ('EXPECTED', 'ON_BOARD', 'DELIVERY_FAILED');

  if v_blocking > 0 then
    raise exception 'students_still_on_trip';
  end if;

  update trip
  set state = 'COMPLETED', actual_completed_at = now()
  where tenant_id = v_tenant and id = p_trip_id;
  if not found then
    raise exception 'trip_complete_failed';
  end if;
end;
$$;

create or replace function mark_delivery_verified(p_override_id uuid, p_trip_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_override delivery_override%rowtype;
  v_student trip_student%rowtype;
begin
  select * into v_override
  from delivery_override
  where tenant_id = v_tenant and id = p_override_id
  for update;
  if not found then
    raise exception 'delivery_override_not_found';
  end if;
  if v_override.status is distinct from 'ACTIVE' then
    raise exception 'delivery_override_not_active';
  end if;
  if v_override.otp_expires_at is not null and v_override.otp_expires_at <= now() then
    raise exception 'delivery_override_expired';
  end if;
  if v_override.locked_until is not null and v_override.locked_until > now() then
    raise exception 'delivery_override_locked';
  end if;

  select * into v_student
  from trip_student
  where tenant_id = v_tenant and id = p_trip_student_id
  for update;
  if not found then
    raise exception 'trip_student_not_found';
  end if;
  if v_student.student_id is distinct from v_override.student_id then
    raise exception 'delivery_override_student_mismatch';
  end if;
  if v_student.delivery_target is distinct from 'TEMP' then
    raise exception 'delivery_override_not_temp';
  end if;

  update trip_student
  set
    delivery_method = 'OTP',
    delivery_verified_at = now(),
    delivery_override_id = p_override_id
  where tenant_id = v_tenant and id = p_trip_student_id;
  if not found then
    raise exception 'trip_student_verify_failed';
  end if;

  update delivery_override
  set
    status = 'VERIFIED',
    verified_at = now(),
    otp_ciphertext = null
  where tenant_id = v_tenant and id = p_override_id;
  if not found then
    raise exception 'delivery_override_verify_failed';
  end if;
end;
$$;

create or replace function admin_override_delivery(
  p_override_id uuid,
  p_trip_student_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_override delivery_override%rowtype;
  v_student trip_student%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'admin_override_reason_required';
  end if;

  select * into v_override
  from delivery_override
  where tenant_id = v_tenant and id = p_override_id
  for update;
  if not found then
    raise exception 'delivery_override_not_found';
  end if;
  if v_override.status not in ('ACTIVE', 'LOCKED', 'EXPIRED') then
    raise exception 'delivery_override_not_active';
  end if;

  select * into v_student
  from trip_student
  where tenant_id = v_tenant and id = p_trip_student_id
  for update;
  if not found then
    raise exception 'trip_student_not_found';
  end if;
  if v_student.student_id is distinct from v_override.student_id then
    raise exception 'delivery_override_student_mismatch';
  end if;
  if v_student.delivery_target is distinct from 'TEMP' then
    raise exception 'delivery_override_not_temp';
  end if;

  update trip_student
  set
    delivery_method = 'ADMIN_OVERRIDE',
    delivery_verified_at = now(),
    delivery_override_id = p_override_id
  where tenant_id = v_tenant and id = p_trip_student_id;
  if not found then
    raise exception 'trip_student_verify_failed';
  end if;

  update delivery_override
  set
    status = 'VERIFIED',
    verified_at = now(),
    otp_ciphertext = null
  where tenant_id = v_tenant and id = p_override_id;
  if not found then
    raise exception 'delivery_override_verify_failed';
  end if;
end;
$$;

revoke all on function complete_trip(uuid) from public;
revoke all on function mark_delivery_verified(uuid, uuid) from public;
revoke all on function admin_override_delivery(uuid, uuid, text) from public;

alter function complete_trip(uuid) owner to servisapp_definer;
alter function mark_delivery_verified(uuid, uuid) owner to servisapp_definer;
alter function admin_override_delivery(uuid, uuid, text) owner to servisapp_definer;

grant execute on function complete_trip(uuid) to servisapp_api, servisapp_worker;
grant execute on function mark_delivery_verified(uuid, uuid) to servisapp_api, servisapp_worker;
grant execute on function admin_override_delivery(uuid, uuid, text) to servisapp_api, servisapp_worker;

-- Definer genel tenant_isolation listesinde değil: app_tenant_id() GUC yokken
-- exception fırlatır ve resolve_session gibi kiracısız bakışları kırar.
-- Sefer fonksiyonları GUC set edilmiş istekle çağrılır.
create policy trip_definer_isolation on trip
  as permissive for all
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()))
  with check (tenant_id = (select app_tenant_id()));

create policy trip_student_definer_isolation on trip_student
  as permissive for all
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()))
  with check (tenant_id = (select app_tenant_id()));

create policy delivery_override_definer_isolation on delivery_override
  as permissive for all
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()))
  with check (tenant_id = (select app_tenant_id()));

create policy trip_vehicle_check_definer_isolation on trip_vehicle_check
  as permissive for select
  to servisapp_definer
  using (tenant_id = (select app_tenant_id()));

-- Varsayılan partition kaçan satırları tutar; aylık dilimler boşken açılır.
do $$
declare
  start_d date;
  end_d date;
  i integer;
begin
  for i in 0..5 loop
    start_d := (date_trunc('month', now()) + make_interval(months => i))::date;
    end_d := (date_trunc('month', now()) + make_interval(months => i + 1))::date;
    execute format(
      'create table if not exists %I partition of event for values from (%L) to (%L)',
      'event_' || to_char(start_d, 'YYYY_MM'),
      start_d,
      end_d
    );
    execute format(
      'create table if not exists %I partition of vehicle_location_ping for values from (%L) to (%L)',
      'vehicle_location_ping_' || to_char(start_d, 'YYYY_MM'),
      start_d,
      end_d
    );
  end loop;
end
$$;

-- Partition'a doğrudan SELECT parent RLS'ini atlar. FORCE + politika kopyası
-- hem yönlendirilmiş INSERT'i hem doğrudan okumayı kiracıya bağlar.
do $$
declare
  r record;
begin
  for r in
    select c.relname as name
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname in ('event', 'vehicle_location_ping')
  loop
    execute format('alter table %I enable row level security', r.name);
    execute format('alter table %I force row level security', r.name);
    execute format(
      $p$
        create policy %I on %I
          as permissive for all
          to servisapp_api, servisapp_worker, servisapp_definer
          using (tenant_id = (select app_tenant_id()))
          with check (tenant_id = (select app_tenant_id()))
      $p$,
      r.name || '_tenant_isolation',
      r.name
    );
    execute format(
      'grant select, insert on table %I to servisapp_api, servisapp_worker',
      r.name
    );
  end loop;
end
$$;
