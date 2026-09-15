-- Unique constraint adları drizzle şemasındaki adlarla eşitlenir.
--
-- Migration'lar unique kısıtları CREATE TABLE içinde ADSIZ tanımlamış; Postgres
-- bunlara `<tablo>_<kolonlar>_key` biçiminde otomatik ad vermiş. Drizzle şeması
-- ise `notification_dedupe`, `trip_route_date` gibi konuşulan adları ilan
-- ediyor. Fark yalnız kozmetik değil: uygulama bazı yerlerde ihlali KISIT ADIYLA
-- yakalıyor (isUniqueViolation). Ad tutmadığı için:
--   * notification_dedupe  -> yinelenen bildirim yutulamıyor, işlem patlıyordu,
--   * pending_command_dependency_pk -> komut erteleme aynı şekilde patlıyordu.
-- Tek doğruluk kaynağı drizzle şemasıdır; veritabanı ona göre adlandırılır.

create or replace function rename_constraint_if_needed(
  p_table text,
  p_old text,
  p_new text
)
returns void
language plpgsql
-- Şemadaki diğer bütün fonksiyonlar gibi arama yolu sabitlenir; bu fonksiyon
-- dosyanın sonunda düşürülür ama kural kuralıdır.
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = p_table::regclass and conname = p_new
  ) then
    return;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = p_table::regclass and conname = p_old
  ) then
    return;
  end if;
  execute format('alter table %I rename constraint %I to %I', p_table, p_old, p_new);
end;
$$;

do $$
begin
  perform rename_constraint_if_needed('address', 'address_tenant_id_id_key', 'address_tenant_row');
  perform rename_constraint_if_needed('command_receipt', 'command_receipt_tenant_id_client_event_id_key', 'command_receipt_pk');
  perform rename_constraint_if_needed('critical_change_ack', 'critical_change_ack_tenant_id_alert_id_membership_id_key', 'critical_change_ack_pk');
  perform rename_constraint_if_needed('critical_change_alert', 'critical_change_alert_tenant_id_id_key', 'critical_change_alert_tenant_row');
  perform rename_constraint_if_needed('delivery_override', 'delivery_override_tenant_id_id_key', 'delivery_override_tenant_row');
  perform rename_constraint_if_needed('device', 'device_tenant_id_id_key', 'device_tenant_row');
  perform rename_constraint_if_needed('guardian_invite', 'guardian_invite_tenant_id_id_key', 'guardian_invite_tenant_row');
  perform rename_constraint_if_needed('import_batch', 'import_batch_tenant_id_id_key', 'import_batch_tenant_row');
  perform rename_constraint_if_needed('import_batch_row', 'import_batch_row_tenant_id_id_key', 'import_batch_row_tenant_row');
  perform rename_constraint_if_needed('import_batch_row', 'import_batch_row_tenant_id_batch_id_row_no_key', 'import_batch_row_no');
  perform rename_constraint_if_needed('invite_sms', 'invite_sms_tenant_id_id_key', 'invite_sms_tenant_row');
  perform rename_constraint_if_needed('notification', 'notification_tenant_id_dedupe_key_key', 'notification_dedupe');
  perform rename_constraint_if_needed('pending_command_dependency', 'pending_command_dependency_tenant_id_client_event_id_key', 'pending_command_dependency_pk');
  perform rename_constraint_if_needed('route', 'route_tenant_id_vehicle_id_segment_shift_no_key', 'route_vehicle_segment_shift');
  perform rename_constraint_if_needed('route', 'route_tenant_id_id_key', 'route_tenant_row');
  perform rename_constraint_if_needed('route_segment_stat', 'route_segment_stat_tenant_id_route_id_from_stop_id_to_stop__key', 'route_segment_stat_bucket');
  perform rename_constraint_if_needed('route_stop', 'route_stop_route_version_id_seq_key', 'route_stop_seq');
  perform rename_constraint_if_needed('route_stop', 'route_stop_tenant_id_id_key', 'route_stop_tenant_row');
  perform rename_constraint_if_needed('route_stop_student', 'route_stop_student_route_stop_id_student_id_key', 'route_stop_student_pair');
  perform rename_constraint_if_needed('route_version', 'route_version_tenant_id_route_id_version_no_key', 'route_version_no');
  perform rename_constraint_if_needed('route_version', 'route_version_tenant_id_id_key', 'route_version_tenant_row');
  perform rename_constraint_if_needed('school', 'school_tenant_id_id_key', 'school_tenant_row');
  perform rename_constraint_if_needed('school_calendar_day', 'school_calendar_day_tenant_id_school_id_date_key', 'school_calendar_day_pk');
  perform rename_constraint_if_needed('stop', 'stop_tenant_id_id_key', 'stop_tenant_row');
  perform rename_constraint_if_needed('stop_travel_time_cache', 'stop_travel_time_cache_tenant_id_from_stop_id_to_stop_id_key', 'stop_travel_time_cache_edge');
  perform rename_constraint_if_needed('student', 'student_tenant_id_id_key', 'student_tenant_row');
  perform rename_constraint_if_needed('student_guardian', 'student_guardian_tenant_id_student_id_guardian_membership_i_key', 'student_guardian_pair');
  perform rename_constraint_if_needed('student_trip_move', 'student_trip_move_tenant_id_student_id_service_date_segment_key', 'student_trip_move_unique');
  perform rename_constraint_if_needed('tenant_membership', 'tenant_membership_tenant_id_identity_id_key', 'tenant_membership_identity');
  perform rename_constraint_if_needed('tenant_membership', 'tenant_membership_tenant_id_id_key', 'tenant_membership_tenant_row');
  perform rename_constraint_if_needed('trip', 'trip_tenant_id_route_id_service_date_key', 'trip_route_date');
  perform rename_constraint_if_needed('trip', 'trip_tenant_id_id_key', 'trip_tenant_row');
  perform rename_constraint_if_needed('trip_stop', 'trip_stop_tenant_id_trip_id_seq_key', 'trip_stop_seq');
  perform rename_constraint_if_needed('trip_stop', 'trip_stop_tenant_id_id_key', 'trip_stop_tenant_row');
  perform rename_constraint_if_needed('trip_stop_student', 'trip_stop_student_tenant_id_trip_stop_id_student_id_key', 'trip_stop_student_pk');
  perform rename_constraint_if_needed('trip_student', 'trip_student_tenant_id_trip_id_student_id_key', 'trip_student_unique');
  perform rename_constraint_if_needed('trip_student', 'trip_student_tenant_id_id_key', 'trip_student_tenant_row');
  perform rename_constraint_if_needed('trip_vehicle_check', 'trip_vehicle_check_tenant_id_trip_id_phase_key', 'trip_vehicle_check_phase');
  perform rename_constraint_if_needed('vehicle', 'vehicle_tenant_id_plate_key', 'vehicle_plate');
  perform rename_constraint_if_needed('vehicle', 'vehicle_tenant_id_id_key', 'vehicle_tenant_row');
  perform rename_constraint_if_needed('vehicle_current_location', 'vehicle_current_location_tenant_id_vehicle_id_key', 'vehicle_current_location_pk');
end
$$;

-- Yabancı anahtarlar da adsız tanımlanmıştı. Kod bunları adla yakalamıyor ama
-- sonraki migration'lar `drop constraint <ad>` yazarken şemadaki adı kullanır;
-- şema dosyası belge olarak doğru kalmalı.
do $$
begin
  perform rename_constraint_if_needed('address', 'address_tenant_id_fkey', 'address_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('address_change_request', 'address_change_request_tenant_id_fkey', 'address_change_request_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('address_change_request', 'address_change_request_tenant_id_student_id_fkey', 'address_change_request_student_fk');
  perform rename_constraint_if_needed('address_change_request', 'address_change_request_tenant_id_proposed_address_id_fkey', 'address_change_request_address_fk');
  perform rename_constraint_if_needed('command_receipt', 'command_receipt_tenant_id_fkey', 'command_receipt_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('critical_change_ack', 'critical_change_ack_tenant_id_fkey', 'critical_change_ack_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('critical_change_ack', 'critical_change_ack_tenant_id_alert_id_fkey', 'critical_change_ack_alert_fk');
  perform rename_constraint_if_needed('critical_change_alert', 'critical_change_alert_tenant_id_fkey', 'critical_change_alert_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('critical_change_alert', 'critical_change_alert_tenant_id_trip_id_fkey', 'critical_change_alert_trip_fk');
  perform rename_constraint_if_needed('delivery_override', 'delivery_override_tenant_id_fkey', 'delivery_override_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('delivery_override', 'delivery_override_tenant_id_student_id_fkey', 'delivery_override_student_fk');
  perform rename_constraint_if_needed('delivery_override', 'delivery_override_tenant_id_address_id_fkey', 'delivery_override_address_fk');
  perform rename_constraint_if_needed('delivery_override', 'delivery_override_tenant_id_verified_by_fkey', 'delivery_override_verified_by_fk');
  perform rename_constraint_if_needed('device', 'device_tenant_id_fkey', 'device_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('device', 'device_tenant_id_membership_id_fkey', 'device_membership_fk');
  perform rename_constraint_if_needed('event', 'event_tenant_id_fkey', 'event_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('event', 'event_tenant_id_actor_membership_id_fkey', 'event_actor_fk');
  perform rename_constraint_if_needed('event', 'event_tenant_id_device_id_fkey', 'event_device_fk');
  perform rename_constraint_if_needed('event', 'event_tenant_id_trip_id_fkey', 'event_trip_fk');
  perform rename_constraint_if_needed('event', 'event_tenant_id_vehicle_id_fkey', 'event_vehicle_fk');
  perform rename_constraint_if_needed('guardian_invite', 'guardian_invite_tenant_id_fkey', 'guardian_invite_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('guardian_invite', 'guardian_invite_identity_id_fkey', 'guardian_invite_identity_id_identity_id_fk');
  perform rename_constraint_if_needed('guardian_invite', 'guardian_invite_tenant_id_membership_id_fkey', 'guardian_invite_membership_fk');
  perform rename_constraint_if_needed('import_batch', 'import_batch_tenant_id_fkey', 'import_batch_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('import_batch_row', 'import_batch_row_tenant_id_fkey', 'import_batch_row_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('import_batch_row', 'import_batch_row_tenant_id_batch_id_fkey', 'import_batch_row_batch_fk');
  perform rename_constraint_if_needed('invite_sms', 'invite_sms_tenant_id_fkey', 'invite_sms_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('invite_sms', 'invite_sms_tenant_id_invite_id_fkey', 'invite_sms_invite_fk');
  perform rename_constraint_if_needed('membership_role', 'membership_role_tenant_id_fkey', 'membership_role_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('membership_role', 'membership_role_tenant_id_membership_id_fkey', 'membership_role_membership_fk');
  perform rename_constraint_if_needed('notification', 'notification_tenant_id_fkey', 'notification_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('notification', 'notification_tenant_id_recipient_membership_id_fkey', 'notification_recipient_fk');
  perform rename_constraint_if_needed('pending_command_dependency', 'pending_command_dependency_tenant_id_fkey', 'pending_command_dependency_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('ride_exception', 'ride_exception_tenant_id_fkey', 'ride_exception_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('ride_exception', 'ride_exception_tenant_id_student_id_fkey', 'ride_exception_student_fk');
  perform rename_constraint_if_needed('ride_exception', 'ride_exception_tenant_id_created_by_membership_id_fkey', 'ride_exception_actor_fk');
  perform rename_constraint_if_needed('route', 'route_tenant_id_fkey', 'route_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('route', 'route_tenant_id_vehicle_id_fkey', 'route_vehicle_fk');
  perform rename_constraint_if_needed('route', 'route_tenant_id_school_id_fkey', 'route_school_fk');
  perform rename_constraint_if_needed('route_segment_stat', 'route_segment_stat_tenant_id_fkey', 'route_segment_stat_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('route_segment_stat', 'route_segment_stat_tenant_id_route_id_fkey', 'route_segment_stat_route_fk');
  perform rename_constraint_if_needed('route_stop', 'route_stop_tenant_id_fkey', 'route_stop_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('route_stop', 'route_stop_tenant_id_route_version_id_fkey', 'route_stop_version_fk');
  perform rename_constraint_if_needed('route_stop', 'route_stop_tenant_id_stop_id_fkey', 'route_stop_stop_fk');
  perform rename_constraint_if_needed('route_stop_student', 'route_stop_student_tenant_id_fkey', 'route_stop_student_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('route_stop_student', 'route_stop_student_tenant_id_route_stop_id_fkey', 'route_stop_student_stop_fk');
  perform rename_constraint_if_needed('route_stop_student', 'route_stop_student_tenant_id_student_id_fkey', 'route_stop_student_student_fk');
  perform rename_constraint_if_needed('route_version', 'route_version_tenant_id_fkey', 'route_version_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('route_version', 'route_version_tenant_id_route_id_fkey', 'route_version_route_fk');
  perform rename_constraint_if_needed('school', 'school_tenant_id_fkey', 'school_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('school', 'school_tenant_id_address_id_fkey', 'school_address_fk');
  perform rename_constraint_if_needed('school_calendar_day', 'school_calendar_day_tenant_id_fkey', 'school_calendar_day_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('school_calendar_day', 'school_calendar_day_tenant_id_school_id_fkey', 'school_calendar_day_school_fk');
  perform rename_constraint_if_needed('staff_assignment', 'staff_assignment_tenant_id_fkey', 'staff_assignment_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('staff_assignment', 'staff_assignment_tenant_id_vehicle_id_fkey', 'staff_assignment_vehicle_fk');
  perform rename_constraint_if_needed('staff_assignment', 'staff_assignment_tenant_id_membership_id_fkey', 'staff_assignment_membership_fk');
  perform rename_constraint_if_needed('stop', 'stop_tenant_id_fkey', 'stop_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('stop', 'stop_tenant_id_address_id_fkey', 'stop_address_fk');
  perform rename_constraint_if_needed('stop_travel_time_cache', 'stop_travel_time_cache_tenant_id_fkey', 'stop_travel_time_cache_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('stop_travel_time_cache', 'stop_travel_time_cache_tenant_id_from_stop_id_fkey', 'stop_travel_time_from_fk');
  perform rename_constraint_if_needed('stop_travel_time_cache', 'stop_travel_time_cache_tenant_id_to_stop_id_fkey', 'stop_travel_time_to_fk');
  perform rename_constraint_if_needed('student', 'student_tenant_id_fkey', 'student_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('student', 'student_tenant_id_school_id_fkey', 'student_school_fk');
  perform rename_constraint_if_needed('student_address', 'student_address_tenant_id_fkey', 'student_address_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('student_address', 'student_address_tenant_id_student_id_fkey', 'student_address_student_fk');
  perform rename_constraint_if_needed('student_address', 'student_address_tenant_id_address_id_fkey', 'student_address_address_fk');
  perform rename_constraint_if_needed('student_guardian', 'student_guardian_tenant_id_fkey', 'student_guardian_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('student_guardian', 'student_guardian_tenant_id_student_id_fkey', 'student_guardian_student_fk');
  perform rename_constraint_if_needed('student_guardian', 'student_guardian_tenant_id_guardian_membership_id_fkey', 'student_guardian_membership_fk');
  perform rename_constraint_if_needed('student_trip_move', 'student_trip_move_tenant_id_fkey', 'student_trip_move_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('student_trip_move', 'student_trip_move_tenant_id_student_id_fkey', 'student_trip_move_student_fk');
  perform rename_constraint_if_needed('student_trip_move', 'student_trip_move_tenant_id_target_route_id_fkey', 'student_trip_move_route_fk');
  perform rename_constraint_if_needed('tenant_membership', 'tenant_membership_tenant_id_fkey', 'tenant_membership_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('tenant_membership', 'tenant_membership_identity_id_fkey', 'tenant_membership_identity_id_identity_id_fk');
  perform rename_constraint_if_needed('trip', 'trip_tenant_id_fkey', 'trip_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('trip', 'trip_tenant_id_route_id_fkey', 'trip_route_fk');
  perform rename_constraint_if_needed('trip', 'trip_tenant_id_route_version_id_fkey', 'trip_route_version_fk');
  perform rename_constraint_if_needed('trip', 'trip_tenant_id_current_vehicle_id_fkey', 'trip_vehicle_fk');
  perform rename_constraint_if_needed('trip', 'trip_tenant_id_current_driver_membership_id_fkey', 'trip_driver_fk');
  perform rename_constraint_if_needed('trip', 'trip_tenant_id_current_attendant_membership_id_fkey', 'trip_attendant_fk');
  perform rename_constraint_if_needed('trip', 'trip_tenant_id_location_source_device_id_fkey', 'trip_location_device_fk');
  perform rename_constraint_if_needed('trip_crew_assignment', 'trip_crew_assignment_tenant_id_fkey', 'trip_crew_assignment_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('trip_crew_assignment', 'trip_crew_assignment_tenant_id_trip_id_fkey', 'trip_crew_assignment_trip_fk');
  perform rename_constraint_if_needed('trip_crew_assignment', 'trip_crew_assignment_tenant_id_membership_id_fkey', 'trip_crew_assignment_membership_fk');
  perform rename_constraint_if_needed('trip_stop', 'trip_stop_tenant_id_fkey', 'trip_stop_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('trip_stop', 'trip_stop_tenant_id_trip_id_fkey', 'trip_stop_trip_fk');
  perform rename_constraint_if_needed('trip_stop', 'trip_stop_tenant_id_source_stop_id_fkey', 'trip_stop_source_fk');
  perform rename_constraint_if_needed('trip_stop_student', 'trip_stop_student_tenant_id_fkey', 'trip_stop_student_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('trip_stop_student', 'trip_stop_student_tenant_id_trip_stop_id_fkey', 'trip_stop_student_stop_fk');
  perform rename_constraint_if_needed('trip_stop_student', 'trip_stop_student_tenant_id_student_id_fkey', 'trip_stop_student_student_fk');
  perform rename_constraint_if_needed('trip_student', 'trip_student_tenant_id_fkey', 'trip_student_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('trip_student', 'trip_student_tenant_id_trip_id_fkey', 'trip_student_trip_fk');
  perform rename_constraint_if_needed('trip_student', 'trip_student_tenant_id_student_id_fkey', 'trip_student_student_fk');
  perform rename_constraint_if_needed('trip_student', 'trip_student_tenant_id_expected_stop_id_fkey', 'trip_student_expected_stop_fk');
  perform rename_constraint_if_needed('trip_student', 'trip_student_tenant_id_actual_stop_id_fkey', 'trip_student_actual_stop_fk');
  perform rename_constraint_if_needed('trip_student', 'trip_student_tenant_id_delivery_override_id_fkey', 'trip_student_override_fk');
  perform rename_constraint_if_needed('trip_student', 'trip_student_tenant_id_counterpart_trip_student_id_fkey', 'trip_student_counterpart_fk');
  perform rename_constraint_if_needed('trip_vehicle_assignment', 'trip_vehicle_assignment_tenant_id_fkey', 'trip_vehicle_assignment_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('trip_vehicle_assignment', 'trip_vehicle_assignment_tenant_id_trip_id_fkey', 'trip_vehicle_assignment_trip_fk');
  perform rename_constraint_if_needed('trip_vehicle_assignment', 'trip_vehicle_assignment_tenant_id_vehicle_id_fkey', 'trip_vehicle_assignment_vehicle_fk');
  perform rename_constraint_if_needed('trip_vehicle_check', 'trip_vehicle_check_tenant_id_fkey', 'trip_vehicle_check_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('trip_vehicle_check', 'trip_vehicle_check_tenant_id_trip_id_fkey', 'trip_vehicle_check_trip_fk');
  perform rename_constraint_if_needed('trip_vehicle_check', 'trip_vehicle_check_tenant_id_checked_by_fkey', 'trip_vehicle_check_membership_fk');
  perform rename_constraint_if_needed('vehicle', 'vehicle_tenant_id_fkey', 'vehicle_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('vehicle_current_location', 'vehicle_current_location_tenant_id_fkey', 'vehicle_current_location_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('vehicle_current_location', 'vehicle_current_location_tenant_id_vehicle_id_fkey', 'vehicle_current_location_vehicle_fk');
  perform rename_constraint_if_needed('vehicle_current_location', 'vehicle_current_location_tenant_id_trip_id_fkey', 'vehicle_current_location_trip_fk');
  perform rename_constraint_if_needed('vehicle_current_location', 'vehicle_current_location_tenant_id_source_device_id_fkey', 'vehicle_current_location_device_fk');
  perform rename_constraint_if_needed('vehicle_location_ping', 'vehicle_location_ping_tenant_id_fkey', 'vehicle_location_ping_tenant_id_tenant_id_fk');
  perform rename_constraint_if_needed('vehicle_location_ping', 'vehicle_location_ping_tenant_id_trip_id_fkey', 'vehicle_location_ping_trip_fk');
  perform rename_constraint_if_needed('vehicle_location_ping', 'vehicle_location_ping_tenant_id_vehicle_id_fkey', 'vehicle_location_ping_vehicle_fk');
end
$$;

-- CREATE TABLE içinde adsız yazılmış kalan kısıtlar: bir check ve iki bölümlü
-- tablonun birincil anahtarı. Şema bunlara `_pk` / açık ad diyor.
do $$
begin
  perform rename_constraint_if_needed('import_batch_row', 'import_batch_row_row_no_check', 'import_batch_row_row_no');
  perform rename_constraint_if_needed('event', 'event_pkey', 'event_pk');
  perform rename_constraint_if_needed('vehicle_location_ping', 'vehicle_location_ping_pkey', 'vehicle_location_ping_pk');
end
$$;

drop function rename_constraint_if_needed(text, text, text);
