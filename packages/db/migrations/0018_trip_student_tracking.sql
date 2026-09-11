-- ETA / yaklaşım kolonları operasyon gerçeği değildir; yine de trip_student
-- UPDATE servisapp_api'ye kapalıdır. Definer fonksiyonu yalnız bu dört kolonu yazar.

create or replace function update_trip_student_tracking(
  p_trip_student_id uuid,
  p_eta_seconds integer,
  p_eta_confidence real,
  p_eta_computed_at timestamptz,
  p_approach_notified_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_updated int;
begin
  update trip_student
  set
    eta_seconds = p_eta_seconds,
    eta_confidence = p_eta_confidence,
    eta_computed_at = p_eta_computed_at,
    approach_notified_at = p_approach_notified_at
  where tenant_id = v_tenant
    and id = p_trip_student_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'trip_student_not_found';
  end if;
end;
$$;

revoke all on function update_trip_student_tracking(uuid, integer, real, timestamptz, timestamptz) from public;
alter function update_trip_student_tracking(uuid, integer, real, timestamptz, timestamptz) owner to servisapp_definer;
grant execute on function update_trip_student_tracking(uuid, integer, real, timestamptz, timestamptz) to servisapp_api;
