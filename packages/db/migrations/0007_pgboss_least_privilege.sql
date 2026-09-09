-- pgboss yalnız worker'ın; partition bakımı public şema ile sınırlı.

revoke usage on schema pgboss from servisapp_api;

create or replace function ensure_month_partitions()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  start_d date;
  end_d date;
  i integer;
  r record;
begin
  for i in 0..5 loop
    start_d := (date_trunc('month', now()) + make_interval(months => i))::date;
    end_d := (date_trunc('month', now()) + make_interval(months => i + 1))::date;
    execute format(
      'create table if not exists public.%I partition of public.event for values from (%L) to (%L)',
      'event_' || to_char(start_d, 'YYYY_MM'),
      start_d,
      end_d
    );
    execute format(
      'create table if not exists public.%I partition of public.vehicle_location_ping for values from (%L) to (%L)',
      'vehicle_location_ping_' || to_char(start_d, 'YYYY_MM'),
      start_d,
      end_d
    );
  end loop;

  for r in
    select c.relname as name
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    join pg_class p on p.oid = i.inhparent
    join pg_namespace pn on pn.oid = p.relnamespace
    where pn.nspname = 'public'
      and cn.nspname = 'public'
      and p.relname in ('event', 'vehicle_location_ping')
  loop
    execute format('alter table public.%I enable row level security', r.name);
    execute format('alter table public.%I force row level security', r.name);
    begin
      execute format(
        $p$
          create policy %I on public.%I
            as permissive for all
            to servisapp_api, servisapp_worker, servisapp_definer
            using (tenant_id = (select app_tenant_id()))
            with check (tenant_id = (select app_tenant_id()))
        $p$,
        r.name || '_tenant_isolation',
        r.name
      );
    exception
      when duplicate_object then
        null;
    end;
    execute format(
      'grant select, insert on table public.%I to servisapp_api, servisapp_worker',
      r.name
    );
  end loop;
end;
$$;

revoke all on function ensure_month_partitions() from public;
grant execute on function ensure_month_partitions() to servisapp_worker;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function ensure_month_partitions() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function ensure_month_partitions() from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function ensure_month_partitions() from service_role';
  end if;
end
$$;
