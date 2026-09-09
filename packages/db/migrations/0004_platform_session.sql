-- Faz 2: min app sürümü, feature flag, kill switch, oturum çözümleme.
-- platform_settings kiracı tablosu değildir; RLS tenant_id kullanmaz.

drop index if exists identity_email_key;
create unique index identity_email_key on identity (lower(email)) where email is not null;

create table platform_settings (
  id boolean primary key default true check (id),
  schema_version integer not null default 1,
  min_supported_app_version text not null default '0.0.0',
  kill_gps boolean not null default false,
  kill_otp boolean not null default false,
  kill_realtime boolean not null default false,
  flags jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into platform_settings (id) values (true);

alter table platform_settings enable row level security;
alter table platform_settings force row level security;

create policy platform_settings_read on platform_settings
  as permissive for select
  to servisapp_api, servisapp_worker
  using (true);

grant select on table platform_settings to servisapp_api, servisapp_worker;

-- Oturum çözümlemesi tenant GUC olmadan identity + üyelik okur.
grant select, insert, update on table identity to servisapp_definer;
grant select, update on table tenant_membership to servisapp_definer;
revoke insert on table identity from servisapp_api, servisapp_worker;
grant select on table membership_role, tenant to servisapp_definer;

create policy identity_definer_session on identity
  as permissive for select
  to servisapp_definer
  using (true);

create policy identity_definer_session_write on identity
  as permissive for insert
  to servisapp_definer
  with check (true);

create policy identity_definer_session_update on identity
  as permissive for update
  to servisapp_definer
  using (true)
  with check (true);

create policy tenant_membership_definer_session on tenant_membership
  as permissive for select
  to servisapp_definer
  using (true);

create policy tenant_membership_definer_session_update on tenant_membership
  as permissive for update
  to servisapp_definer
  using (true)
  with check (true);

create policy membership_role_definer_session on membership_role
  as permissive for select
  to servisapp_definer
  using (true);

create policy tenant_definer_session on tenant
  as permissive for select
  to servisapp_definer
  using (true);

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
  v_email text := nullif(lower(btrim(p_email)), '');
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
    if found and v_identity.auth_user_id is not null
       and v_identity.auth_user_id is distinct from p_auth_user_id then
      raise exception 'identity_auth_mismatch';
    end if;
  end if;

  if not found and v_email is not null then
    select * into v_identity
    from identity
    where lower(email) = v_email
    for update;
    if found and v_identity.auth_user_id is not null
       and v_identity.auth_user_id is distinct from p_auth_user_id then
      raise exception 'identity_auth_mismatch';
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

  update tenant_membership
  set status = 'ACTIVE'
  where identity_id = v_identity.id
    and status = 'INVITED';

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
grant execute on function resolve_session(uuid, text, text) to servisapp_api, servisapp_worker;

-- RLS identity'yi diğer tenant'tan gizler; aynı telefon ikinci şirkete
-- üye edilemez. Bu fonksiyon kiracıdan bağımsız kimlik üretir/bulur.
create or replace function ensure_identity(
  p_phone text,
  p_email text,
  p_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'identity_phone_invalid';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) < 2 then
    raise exception 'identity_name_required';
  end if;

  select id into v_id from identity where phone_e164 = v_phone;
  if found then
    return v_id;
  end if;

  insert into identity (phone_e164, email, full_name)
  values (v_phone, v_email, btrim(p_full_name))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    select id into v_id from identity where phone_e164 = v_phone;
    if found then
      return v_id;
    end if;
    if v_email is not null and exists (
      select 1 from identity where lower(email) = v_email
    ) then
      raise exception 'identity_email_conflict';
    end if;
    raise exception 'identity_conflict';
end;
$$;

revoke all on function ensure_identity(text, text, text) from public;
alter function ensure_identity(text, text, text) owner to servisapp_definer;
grant execute on function ensure_identity(text, text, text) to servisapp_api, servisapp_worker;
