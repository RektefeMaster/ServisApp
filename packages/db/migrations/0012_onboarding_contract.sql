-- V1 kayıt / davet / erişim sözleşmesi (SPEC rev 3.3).
-- Import satırları domain tablosu değildir. Davet student_id taşımaz.

create type guardian_relation_status as enum ('ACTIVE', 'REVOKED');
create type import_row_status as enum (
  'PENDING',
  'READY',
  'NEEDS_FIX',
  'ADDRESS_UNVERIFIED',
  'COMMITTED',
  'FAILED'
);
create type invite_status as enum ('PENDING', 'USED', 'EXPIRED', 'REVOKED');

alter table student
  add column uses_morning boolean not null default true,
  add column uses_evening boolean not null default true,
  add column suspended boolean not null default false;

alter table student_guardian
  add column status guardian_relation_status not null default 'ACTIVE';

create index student_guardian_membership_idx
  on student_guardian (tenant_id, guardian_membership_id)
  where status = 'ACTIVE';

alter table trip
  alter column current_driver_membership_id drop not null;

create table import_batch (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  file_name text,
  file_hash text,
  created_by_membership_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create unique index import_batch_file_hash
  on import_batch (tenant_id, file_hash)
  where file_hash is not null;

create table import_batch_row (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  batch_id uuid not null,
  row_no integer not null,
  raw jsonb not null default '{}'::jsonb,
  status import_row_status not null default 'PENDING',
  error_code text,
  existing_identity_id uuid,
  existing_full_name text,
  student_id uuid,
  identity_id uuid,
  membership_id uuid,
  committed_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, batch_id, row_no),
  foreign key (tenant_id, batch_id) references import_batch (tenant_id, id),
  check (row_no >= 1)
);

create index import_batch_row_batch_idx on import_batch_row (tenant_id, batch_id);

create table guardian_invite (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  identity_id uuid not null references identity (id),
  membership_id uuid not null,
  token_hash bytea not null,
  status invite_status not null default 'PENDING',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by_membership_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id) references tenant_membership (tenant_id, id)
);

create unique index guardian_invite_one_pending
  on guardian_invite (tenant_id, membership_id)
  where status = 'PENDING';

create index guardian_invite_token_hash_idx on guardian_invite (token_hash);

create table invite_sms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  invite_id uuid not null,
  status notification_status not null default 'QUEUED',
  provider text not null default 'dev',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, invite_id) references guardian_invite (tenant_id, id)
);

create index invite_sms_invite_idx on invite_sms (tenant_id, invite_id);

do $$
declare
  t text;
begin
  foreach t in array array['import_batch', 'import_batch_row', 'guardian_invite', 'invite_sms']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
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

grant select, insert, update on table
  import_batch, import_batch_row, guardian_invite, invite_sms
  to servisapp_api, servisapp_worker;

create or replace function find_identity_by_phone(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text := nullif(btrim(p_phone), '');
  v_row identity%rowtype;
begin
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  select * into v_row from identity where phone_e164 = v_phone;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'fullName', v_row.full_name,
    'phone', v_row.phone_e164,
    'authUserId', v_row.auth_user_id
  );
end;
$$;

revoke all on function find_identity_by_phone(text) from public;
alter function find_identity_by_phone(text) owner to servisapp_definer;
grant execute on function find_identity_by_phone(text) to servisapp_api, servisapp_worker;

create or replace function find_invite_by_token_hash(p_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite guardian_invite%rowtype;
  v_tenant_name text;
  v_phone text;
  v_full_name text;
begin
  if p_hash is null then
    return null;
  end if;

  select * into v_invite from guardian_invite where token_hash = p_hash;
  if not found then
    return null;
  end if;

  if v_invite.status = 'PENDING' and v_invite.expires_at < now() then
    update guardian_invite
    set status = 'EXPIRED'
    where id = v_invite.id and status = 'PENDING';
    v_invite.status := 'EXPIRED';
  end if;

  select name into v_tenant_name from tenant where id = v_invite.tenant_id;
  select phone_e164, full_name into v_phone, v_full_name
  from identity where id = v_invite.identity_id;

  return jsonb_build_object(
    'id', v_invite.id,
    'tenantId', v_invite.tenant_id,
    'tenantName', v_tenant_name,
    'identityId', v_invite.identity_id,
    'membershipId', v_invite.membership_id,
    'status', v_invite.status,
    'phone', v_phone,
    'fullName', v_full_name,
    'expiresAt', v_invite.expires_at
  );
end;
$$;

revoke all on function find_invite_by_token_hash(bytea) from public;
alter function find_invite_by_token_hash(bytea) owner to servisapp_definer;
grant execute on function find_invite_by_token_hash(bytea) to servisapp_api, servisapp_worker;
