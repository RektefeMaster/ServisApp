-- E-posta ile bağlanmamış kimliğe auth_user_id yazılmaz.
-- Personel ilk girişi telefon (OTP / JWT phone) ile bağlanır; aynı e-postayla
-- Supabase kaydı personel/yönetici üyeliğini çalamaz.

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
grant execute on function resolve_session(uuid, text, text) to servisapp_api, servisapp_worker;
