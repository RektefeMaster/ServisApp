-- Geliştirme girişi fonksiyonları artık ÜRETİMDE ÖLÜ.
--
-- HTTP uçları zaten `NODE_ENV=production` ile kapalıydı, ama fonksiyonların
-- kendisi üretim şemasında duruyor ve `servisapp_api`'ye EXECUTE verilmişti.
-- İkisi de SECURITY DEFINER'dır ve RLS'i atlayarak herhangi bir e-posta/telefon
-- için kimlik satırı (auth_user_id, telefon, e-posta, ad) döndürür. Uygulama
-- rolünün ele geçtiği bir senaryoda bu, kiracı bağlamı olmadan kimlik taraması
-- demekti.
--
-- Kapı kill switch'lerle aynı yerde ve aynı mantıkta: `servisapp_api`
-- `platform_settings`'i UPDATE EDEMEZ, dolayısıyla bayrağı kendisi açamaz.
-- Varsayılan kapalıdır; yerel geliştirme ve e2e bir kez açar:
--   pnpm db:platform -- --dev-login=true
alter table platform_settings
  add column if not exists dev_login_enabled boolean not null default false;

-- Bayrağı OKUYAN, fonksiyonların kendisidir ve onlar `servisapp_definer` olarak
-- koşar. `platform_settings` FORCE RLS altındadır ve 0004 yalnız api/worker'a
-- select vermişti; definer okuyamazsa fonksiyon 500 ile patlar. Yalnız SELECT.
grant select on table platform_settings to servisapp_definer;

drop policy if exists platform_settings_definer_read on platform_settings;
create policy platform_settings_definer_read on platform_settings
  as permissive for select
  to servisapp_definer
  using (true);

create or replace function find_dev_login_identity(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identity identity%rowtype;
  v_has_crew boolean;
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if not exists (select 1 from platform_settings where id = true and dev_login_enabled) then
    return null;
  end if;

  if v_email is null then
    return null;
  end if;

  select * into v_identity
  from identity
  where lower(email) = v_email;

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
      and mr.role in ('DRIVER', 'ATTENDANT', 'ADMIN')
  ) into v_has_crew;

  return jsonb_build_object(
    'authUserId', v_identity.auth_user_id,
    'identityId', v_identity.id,
    'fullName', v_identity.full_name,
    'phone', v_identity.phone_e164,
    'email', v_identity.email,
    'hasCrewRole', v_has_crew
  );
end;
$$;

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
  if not exists (select 1 from platform_settings where id = true and dev_login_enabled) then
    return null;
  end if;

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

revoke all on function find_dev_login_identity(text) from public;
revoke all on function find_dev_parent_identity(text) from public;
alter function find_dev_login_identity(text) owner to servisapp_definer;
alter function find_dev_parent_identity(text) owner to servisapp_definer;
grant execute on function find_dev_login_identity(text) to servisapp_api;
grant execute on function find_dev_parent_identity(text) to servisapp_api;
