-- Hosted Supabase'te yeni public tablolar anon/authenticated/service_role'e
-- ALL gelir. Istemciler Data API kullanmaz; Fastify kısıtlı rollerle bağlanır.
-- anon/authenticated yerel docker'da yoktur — REVOKE koşullu.

alter function app_tenant_id() set search_path = public, pg_temp;
alter function forbid_append_only_mutation() set search_path = public, pg_temp;
alter function protect_delivery_columns() set search_path = public, pg_temp;
alter function prevent_complete_with_students_on_board() set search_path = public, pg_temp;

revoke all on function app_tenant_id() from public;
revoke all on function forbid_append_only_mutation() from public;
revoke all on function protect_delivery_columns() from public;
revoke all on function prevent_complete_with_students_on_board() from public;
revoke all on function complete_trip(uuid) from public;
revoke all on function mark_delivery_verified(uuid, uuid) from public;
revoke all on function admin_override_delivery(uuid, uuid, text) from public;
revoke all on function resolve_session(uuid, text, text) from public;
revoke all on function ensure_identity(text, text, text) from public;

grant execute on function app_tenant_id() to servisapp_api, servisapp_worker, servisapp_definer;
grant execute on function forbid_append_only_mutation() to servisapp_api, servisapp_worker, servisapp_definer;
grant execute on function protect_delivery_columns() to servisapp_api, servisapp_worker, servisapp_definer;
grant execute on function prevent_complete_with_students_on_board() to servisapp_api, servisapp_worker, servisapp_definer;

grant usage, create on schema public to postgres;
grant usage, create on schema public to servisapp_definer;
grant usage on schema public to servisapp_api, servisapp_worker;

create index if not exists tenant_membership_identity_id_idx
  on tenant_membership (identity_id);

create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

insert into schema_migrations (filename)
values
  ('0001_schema.sql'),
  ('0002_rls_grants.sql'),
  ('0003_functions.sql'),
  ('0004_platform_session.sql'),
  ('0005_data_api_lock.sql')
on conflict (filename) do nothing;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'grant usage, create on schema public to supabase_admin';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
    execute 'revoke usage on schema public from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'revoke all on all functions in schema public from authenticated';
    execute 'revoke usage on schema public from authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on all tables in schema public from service_role';
    execute 'revoke all on all sequences in schema public from service_role';
    execute 'revoke all on all functions in schema public from service_role';
  end if;
end
$$;

do $$
begin
  execute 'alter default privileges for role postgres in schema public revoke all on tables from public';
  execute 'alter default privileges for role postgres in schema public revoke all on sequences from public';
  execute 'alter default privileges for role postgres in schema public revoke all on functions from public';

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges for role postgres in schema public revoke all on tables from anon';
    execute 'alter default privileges for role postgres in schema public revoke all on sequences from anon';
    execute 'alter default privileges for role postgres in schema public revoke all on functions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'alter default privileges for role postgres in schema public revoke all on tables from authenticated';
    execute 'alter default privileges for role postgres in schema public revoke all on sequences from authenticated';
    execute 'alter default privileges for role postgres in schema public revoke all on functions from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'alter default privileges for role postgres in schema public revoke all on tables from service_role';
    execute 'alter default privileges for role postgres in schema public revoke all on sequences from service_role';
    execute 'alter default privileges for role postgres in schema public revoke all on functions from service_role';
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    begin
      execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from public';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from authenticated';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from service_role';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from public';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from authenticated';
      execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from service_role';
    exception
      when insufficient_privilege then
        null;
    end;
  end if;
end
$$;
