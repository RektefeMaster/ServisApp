-- ETA yazımı öğrenci başına bir gidiş-dönüş olmaktan çıkıyor.
--
-- `refreshStudentEtas` kabul edilen HER GPS ping'inde (araç başına ~8 sn)
-- takip edilen her öğrenci için ayrı `update_trip_student_tracking(...)`
-- çağırıyordu — üstelik sırayla ve `vehicle_current_location` üzerinde
-- `FOR UPDATE` tutan transaction'ın içinde. 50 araç × ~18 öğrenci, saniyede
-- ~110 ayrı ifade demekti ve bu sayı araç × öğrenci ile doğrusal büyüyor.
-- Yük koşusu da bu yolu ölçmüyor (domain motorunu ölçüyor), yani sahada ilk
-- zorlanacak yer burasıydı.
--
-- Tek çağrı, tek UPDATE. Kolonlara yazma yetkisi yine yalnız definer'da.
create or replace function update_trip_student_tracking_batch(
  p_rows jsonb,
  p_eta_confidence real,
  p_eta_computed_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := app_tenant_id();
  v_updated int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'tracking_rows_invalid';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  update trip_student ts
  set
    eta_seconds = src.eta_seconds,
    eta_confidence = p_eta_confidence,
    eta_computed_at = p_eta_computed_at,
    approach_notified_at = src.approach_notified_at
  from jsonb_to_recordset(p_rows) as src(
    trip_student_id uuid,
    eta_seconds integer,
    approach_notified_at timestamptz
  )
  where ts.tenant_id = v_tenant
    and ts.id = src.trip_student_id;

  get diagnostics v_updated = row_count;
  -- Eksik satır sessizce yutulmaz: ping'in gövdesi ile seferin öğrenci listesi
  -- ayrışmışsa bunu bilmek isteriz.
  if v_updated <> jsonb_array_length(p_rows) then
    raise exception 'trip_student_not_found';
  end if;
  return v_updated;
end;
$$;

revoke all on function update_trip_student_tracking_batch(jsonb, real, timestamptz) from public;
alter function update_trip_student_tracking_batch(jsonb, real, timestamptz)
  owner to servisapp_definer;
grant execute on function update_trip_student_tracking_batch(jsonb, real, timestamptz)
  to servisapp_api;
