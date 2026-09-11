-- identity UPDATE WITH CHECK üyelik şartına bağlanır.
-- Personel rolü, bekleyen veli davetini / GUARDIAN üyeliğini ACTIVE yapmaz.

drop policy if exists identity_update_via_membership on identity;
create policy identity_update_via_membership on identity
  as permissive for update
  to servisapp_api, servisapp_worker
  using (
    exists (
      select 1 from tenant_membership tm
      where tm.identity_id = identity.id
        and tm.tenant_id = (select app_tenant_id())
    )
  )
  with check (
    exists (
      select 1 from tenant_membership tm
      where tm.identity_id = identity.id
        and tm.tenant_id = (select app_tenant_id())
    )
  );

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
    )
    and not exists (
      select 1
      from membership_role mr
      where mr.tenant_id = tm.tenant_id
        and mr.membership_id = tm.id
        and mr.role = 'GUARDIAN'
    )
    and not exists (
      select 1
      from guardian_invite gi
      where gi.tenant_id = tm.tenant_id
        and gi.membership_id = tm.id
        and gi.status = 'PENDING'
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
revoke execute on function resolve_session(uuid, text, text) from servisapp_worker;
