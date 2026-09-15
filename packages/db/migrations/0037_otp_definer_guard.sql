-- Teslim kodu kolonları artık gerçekten korunuyor.
--
-- 0021'deki tetik yalnız TEK bir UPDATE içinde non-null → non-null geçişini
-- engelliyordu. servisapp_api iki UPDATE ile (önce null, sonra yeni değer) bunu
-- rahatça geçebiliyordu — nitekim uygulamanın kendi "kodu yenile" yolu tam
-- olarak bunu yapıyor ve yorumunda da itiraf ediyordu. Koruma, engellediğini
-- iddia ettiği şeyi hiç engellemiyordu: ele geçmiş bir API rolü, kapıdaki
-- çocuğu teslim almak için kodu sessizce kendi seçtiği değerle değiştirebilirdi.
--
-- Yeni kural şemanın geri kalanıyla aynı (bkz. 0003 `protect_delivery_columns`,
-- `complete_trip`): hash / ciphertext / son kullanma kolonlarına yalnız
-- SECURITY DEFINER fonksiyonlar yazar. Kodu uygulama üretir — pepper ve
-- şifreleme anahtarı yalnız Fastify'da yaşar, veritabanı onları hiç görmez —
-- ama "bu kod yazılabilir mi, kaçıncı yenileme bu" kararını veritabanı verir.

create or replace function protect_otp_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user is not distinct from 'servisapp_definer' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.otp_hmac is not null
       or new.otp_ciphertext is not null
       or new.otp_expires_at is not null then
      raise exception 'otp_columns_are_protected';
    end if;
    return new;
  end if;

  if old.otp_hmac is distinct from new.otp_hmac
     or old.otp_ciphertext is distinct from new.otp_ciphertext
     or old.otp_expires_at is distinct from new.otp_expires_at then
    raise exception 'otp_columns_are_protected';
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_override_protect_otp on delivery_override;
create trigger delivery_override_protect_otp
  before insert or update on delivery_override
  for each row
  execute function protect_otp_columns();

/*
 * Kod yazmanın TEK yolu.
 *
 * `p_is_resend` uygulamanın niyetidir, durumdan türetilmez: süresi dolmuş bir
 * kod temizlendiğinde hash null'a düşer, "hash var mı" sorusu yenilemeyi ilk
 * kod sanardı ve yenileme limiti sessizce sıfırlanırdı. Limitin kendisi
 * burada, veritabanında uygulanır.
 */
create or replace function issue_delivery_otp(
  p_override_id uuid,
  p_hmac bytea,
  p_ciphertext bytea,
  p_expires_at timestamptz,
  p_is_resend boolean,
  p_max_resends integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_row delivery_override%rowtype;
  v_resend integer;
begin
  if p_hmac is null or p_ciphertext is null or p_expires_at is null then
    raise exception 'otp_payload_required';
  end if;
  if p_expires_at <= now() then
    raise exception 'otp_expiry_in_past';
  end if;

  select * into v_row
  from delivery_override
  where tenant_id = v_tenant and id = p_override_id
  for update;
  if not found then
    raise exception 'delivery_override_not_found';
  end if;

  if coalesce(p_is_resend, false) then
    -- Yenileme: kilitli, doğrulanmış ya da iptal talebe kod basılmaz.
    if v_row.status not in ('ACTIVE', 'EXPIRED') then
      raise exception 'delivery_override_not_active';
    end if;
    v_resend := v_row.resend_count + 1;
    if p_max_resends is not null and v_resend > p_max_resends then
      raise exception 'otp_resend_limit';
    end if;
  else
    -- İlk kod: onay bekleyen ya da henüz kodsuz talep. Var olan kodun üstüne
    -- "ilk kod" diye yazılamaz; o yol yenilemedir ve limite tabidir.
    if v_row.status not in ('PENDING_APPROVAL', 'ACTIVE') then
      raise exception 'delivery_override_not_active';
    end if;
    if v_row.otp_hmac is not null then
      raise exception 'delivery_override_has_otp';
    end if;
    v_resend := v_row.resend_count;
  end if;

  update delivery_override
  set otp_hmac = p_hmac,
      otp_ciphertext = p_ciphertext,
      otp_expires_at = p_expires_at,
      attempt_count = 0,
      locked_until = null,
      resend_count = v_resend,
      status = 'ACTIVE'
  where tenant_id = v_tenant and id = p_override_id;
  if not found then
    raise exception 'otp_issue_failed';
  end if;
  return v_resend;
end;
$$;

/*
 * Kodu silmenin TEK yolu: süresi doldu ya da talep iptal edildi.
 * Durum uymuyorsa sessizce `false` döner — çağıranların çoğu yarışta kaybetmiş
 * olabilir ve bu bir hata değildir.
 */
create or replace function clear_delivery_otp(
  p_override_id uuid,
  p_next_status delivery_override_status
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_row delivery_override%rowtype;
begin
  if p_next_status not in ('EXPIRED', 'CANCELLED') then
    raise exception 'otp_clear_status_invalid';
  end if;

  select * into v_row
  from delivery_override
  where tenant_id = v_tenant and id = p_override_id
  for update;
  if not found then
    return false;
  end if;

  if p_next_status = 'EXPIRED' and v_row.status is distinct from 'ACTIVE' then
    return false;
  end if;
  if p_next_status = 'CANCELLED'
     and v_row.status not in ('PENDING_APPROVAL', 'ACTIVE', 'LOCKED') then
    return false;
  end if;

  update delivery_override
  set status = p_next_status,
      otp_hmac = null,
      otp_ciphertext = null
  where tenant_id = v_tenant and id = p_override_id;
  return true;
end;
$$;

revoke all on function issue_delivery_otp(uuid, bytea, bytea, timestamptz, boolean, integer)
  from public;
revoke all on function clear_delivery_otp(uuid, delivery_override_status) from public;

alter function issue_delivery_otp(uuid, bytea, bytea, timestamptz, boolean, integer)
  owner to servisapp_definer;
alter function clear_delivery_otp(uuid, delivery_override_status) owner to servisapp_definer;

-- Kod üretimi yalnız API'dedir; worker teslim koduna hiç dokunmaz.
grant execute on function issue_delivery_otp(uuid, bytea, bytea, timestamptz, boolean, integer)
  to servisapp_api;
grant execute on function clear_delivery_otp(uuid, delivery_override_status) to servisapp_api;

-- Definer bu tabloyu 0003'te yalnız trip/trip_student/delivery_override için
-- görüyordu; INSERT yetkisi yok, sadece SELECT + UPDATE — yeterli.
