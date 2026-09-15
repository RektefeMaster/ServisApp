-- Yönetici teslim onayı, YALNIZ o günün talebini tüketebilir.
--
-- Eski kontrol iki kaydın aynı ÖĞRENCİYE ait olmasına bakıyordu, aynı SERVİS
-- GÜNÜNE ait olmasına değil. Veli yarın için bir "farklı teslimat" talebi
-- girdiyse, bugünkü teslimi onaylamak yarının talebini tüketiyordu: yarının
-- kaydı VERIFIED oluyor ve kodu siliniyordu. Sonuç, yarın çocuğun kapıda
-- hiçbir kod sorulmadan teslim edilmesiydi.
--
-- Bu, panelde yanlış kaydın seçilmesiyle tetikleniyordu; ama asıl yer burasıdır:
-- yetkili kontrol veritabanındadır.

create or replace function admin_override_delivery(
  p_override_id uuid,
  p_trip_student_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_override delivery_override%rowtype;
  v_student trip_student%rowtype;
  v_service_date date;
begin
  if coalesce(current_setting('app.role', true), '') is distinct from 'ADMIN' then
    raise exception 'admin_override_forbidden';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'admin_override_reason_required';
  end if;

  select * into v_override
  from delivery_override
  where tenant_id = v_tenant and id = p_override_id
  for update;
  if not found then
    raise exception 'delivery_override_not_found';
  end if;
  if v_override.status not in ('ACTIVE', 'LOCKED', 'EXPIRED') then
    raise exception 'delivery_override_not_active';
  end if;

  select * into v_student
  from trip_student
  where tenant_id = v_tenant and id = p_trip_student_id
  for update;
  if not found then
    raise exception 'trip_student_not_found';
  end if;
  if v_student.student_id is distinct from v_override.student_id then
    raise exception 'delivery_override_student_mismatch';
  end if;
  if v_student.delivery_target is distinct from 'TEMP' then
    raise exception 'delivery_override_not_temp';
  end if;

  select t.service_date into v_service_date
  from trip t
  where t.tenant_id = v_tenant and t.id = v_student.trip_id;
  if not found then
    raise exception 'trip_not_found';
  end if;
  if v_service_date is distinct from v_override.service_date then
    raise exception 'delivery_override_date_mismatch';
  end if;

  update trip_student
  set
    delivery_method = 'ADMIN_OVERRIDE',
    delivery_verified_at = now(),
    delivery_override_id = p_override_id
  where tenant_id = v_tenant and id = p_trip_student_id;
  if not found then
    raise exception 'trip_student_verify_failed';
  end if;

  update delivery_override
  set
    status = 'VERIFIED',
    verified_at = now(),
    otp_ciphertext = null
  where tenant_id = v_tenant and id = p_override_id;
  if not found then
    raise exception 'delivery_override_verify_failed';
  end if;
end;
$$;
