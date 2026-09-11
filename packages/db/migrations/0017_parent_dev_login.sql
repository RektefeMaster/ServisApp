create or replace function find_dev_parent_identity(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity identity%rowtype;
  v_has_guardian boolean;
begin
  if p_phone is null or btrim(p_phone) = '' then
    return null;
  end if;

  select * into v_identity
  from identity
  where phone_e164 = p_phone;

  if not found then
    return null;
  end if;

  select exists (
    select 1
    from tenant_membership tm
    join membership_role mr
      on mr.membership_id = tm.id
     and mr.tenant_id = tm.tenant_id
    where tm.identity_id = v_identity.id
      and tm.status in ('ACTIVE', 'INVITED')
      and mr.role = 'GUARDIAN'
  ) into v_has_guardian;

  if not v_has_guardian then
    return null;
  end if;

  return jsonb_build_object(
    'authUserId', v_identity.auth_user_id,
    'identityId', v_identity.id,
    'fullName', v_identity.full_name,
    'phone', v_identity.phone_e164,
    'email', v_identity.email
  );
end;
$$;

revoke all on function find_dev_parent_identity(text) from public;
alter function find_dev_parent_identity(text) owner to servisapp_definer;
grant execute on function find_dev_parent_identity(text) to servisapp_api;
