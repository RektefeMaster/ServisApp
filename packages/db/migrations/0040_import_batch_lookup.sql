-- Excel önizlemesi satır başına ~5 gidiş-dönüş yapmaktan çıkıyor.
--
-- `previewImport` her satır için ayrı ayrı: telefonla kimlik ara, kimlik bu
-- kiracıda mı bak, okulu doğrula, mevcut satırı seç, sonra yaz. 500 satırlık
-- tavanda tek transaction içinde ~2500 ardışık ifade demekti — üstelik panel
-- proxy'sinin 20 saniyelik sınırının arkasında ve okulun ilk haftası yolunda.
-- Zaman aşımı olursa operatör hata görür, batch ise aslında yazılmıştır.
--
-- Telefon araması `find_identity_by_phone` gibi kiracılar ötesi bakar (aynı
-- gerekçe: numara başka şirkette kullanımdaysa bunu bilmemiz gerekir), ama
-- yalnız eşleşenleri döner ve kiracı kararını çağırana bırakır.
create or replace function find_identities_by_phones(p_phones text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_phones is null or array_length(p_phones, 1) is null then
    return '[]'::jsonb;
  end if;
  if array_length(p_phones, 1) > 1000 then
    raise exception 'phone_batch_too_large';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'fullName', i.full_name,
        'phone', i.phone_e164,
        'authUserId', i.auth_user_id
      )
    ),
    '[]'::jsonb
  )
  into v_result
  from identity i
  where i.phone_e164 = any (
    select btrim(p)
    from unnest(p_phones) as p
    where nullif(btrim(p), '') is not null
      and btrim(p) ~ '^\+[1-9][0-9]{7,14}$'
  );

  return v_result;
end;
$$;

revoke all on function find_identities_by_phones(text[]) from public;
alter function find_identities_by_phones(text[]) owner to servisapp_definer;
grant execute on function find_identities_by_phones(text[]) to servisapp_api, servisapp_worker;
