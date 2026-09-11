-- Veli telefonu resolve_session ile bağlanmaz; personel/yönetici ilk girişte bağlanır.
-- Teslim doğrulama GUC'süz çağrılamaz. Worker bu fonksiyonları yürütmez.
-- schema_migrations Data API'ye kapalıdır.

create or replace function resolve_session(
  p_auth_user_id uuid,
  p_phone text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity identity%rowtype;
  v_phone text := nullif(btrim(p_phone), '');
  v_staff boolean := false;
begin
  if p_auth_user_id is null then
    raise exception 'auth_user_id_required';
  end if;

  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    v_phone := null;
  end if;

  select * into v_identity
  from identity
  where auth_user_id = p_auth_user_id
  for update;

  if not found and v_phone is not null then
    select * into v_identity
    from identity
    where phone_e164 = v_phone
    for update;
    if found then
      if v_identity.auth_user_id is not null
         and v_identity.auth_user_id is distinct from p_auth_user_id then
        raise exception 'identity_auth_mismatch';
      end if;
      select exists (
        select 1
        from tenant_membership tm
        join membership_role mr
          on mr.tenant_id = tm.tenant_id
         and mr.membership_id = tm.id
        where tm.identity_id = v_identity.id
          and tm.status in ('INVITED', 'ACTIVE')
          and mr.role in ('ADMIN', 'DRIVER', 'ATTENDANT')
      ) into v_staff;
      if not v_staff then
        raise exception 'identity_not_provisioned';
      end if;
    end if;
  end if;

  if not found then
    raise exception 'identity_not_provisioned';
  end if;

  if v_identity.auth_user_id is null then
    update identity
    set auth_user_id = p_auth_user_id
    where id = v_identity.id;
    v_identity.auth_user_id := p_auth_user_id;
  elsif v_identity.auth_user_id is distinct from p_auth_user_id then
    raise exception 'identity_auth_mismatch';
  end if;

  update tenant_membership tm
  set status = 'ACTIVE'
  where tm.identity_id = v_identity.id
    and tm.status = 'INVITED'
    and exists (
      select 1
      from membership_role mr
      where mr.tenant_id = tm.tenant_id
        and mr.membership_id = tm.id
        and mr.role in ('ADMIN', 'DRIVER', 'ATTENDANT')
    );

  return jsonb_build_object(
    'identityId', v_identity.id,
    'fullName', v_identity.full_name,
    'phone', v_identity.phone_e164,
    'email', v_identity.email,
    'memberships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'membershipId', tm.id,
          'tenantId', tm.tenant_id,
          'tenantName', t.name,
          'status', tm.status,
          'roles', coalesce((
            select jsonb_agg(mr.role order by mr.role)
            from membership_role mr
            where mr.tenant_id = tm.tenant_id
              and mr.membership_id = tm.id
          ), '[]'::jsonb)
        )
        order by t.name
      )
      from tenant_membership tm
      join tenant t on t.id = tm.tenant_id
      where tm.identity_id = v_identity.id
        and tm.status in ('ACTIVE', 'INVITED')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function resolve_session(uuid, text, text) from public;
alter function resolve_session(uuid, text, text) owner to servisapp_definer;
grant execute on function resolve_session(uuid, text, text) to servisapp_api;

create or replace function identity_has_other_tenants(
  p_identity_id uuid,
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from tenant_membership
    where identity_id = p_identity_id
      and tenant_id is distinct from p_tenant_id
      and status in ('INVITED', 'ACTIVE', 'SUSPENDED')
  );
$$;

revoke all on function identity_has_other_tenants(uuid, uuid) from public;
alter function identity_has_other_tenants(uuid, uuid) owner to servisapp_definer;
grant execute on function identity_has_other_tenants(uuid, uuid) to servisapp_api;

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
  if coalesce(current_setting('app.delivery_otp_ok', true), '') is distinct from 'on' then
    raise exception 'delivery_otp_not_verified';
  end if;

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
  if coalesce(current_setting('app.role', true), '') is distinct from 'ADMIN' then
    raise exception 'admin_override_forbidden';
  end if;
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

revoke all on function mark_delivery_verified(uuid, uuid) from public;
revoke all on function admin_override_delivery(uuid, uuid, text) from public;
alter function mark_delivery_verified(uuid, uuid) owner to servisapp_definer;
alter function admin_override_delivery(uuid, uuid, text) owner to servisapp_definer;
grant execute on function mark_delivery_verified(uuid, uuid) to servisapp_api;
grant execute on function admin_override_delivery(uuid, uuid, text) to servisapp_api;

revoke execute on function resolve_session(uuid, text, text) from servisapp_worker;
revoke execute on function mark_delivery_verified(uuid, uuid) from servisapp_worker;
revoke execute on function admin_override_delivery(uuid, uuid, text) from servisapp_worker;
revoke execute on function find_identity_by_phone(text) from servisapp_worker;
revoke execute on function ensure_identity(text, text, text) from servisapp_worker;
revoke execute on function find_invite_by_token_hash(bytea) from servisapp_worker;

insert into schema_migrations (filename)
values ('0016_staff_bind_delivery_guard.sql')
on conflict (filename) do nothing;

alter table schema_migrations enable row level security;
alter table schema_migrations force row level security;
revoke all on table schema_migrations from public;
