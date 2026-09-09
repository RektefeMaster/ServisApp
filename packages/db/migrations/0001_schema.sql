-- Faz 1 şema: enum, tablolar, bileşik FK, CHECK, partition.
-- Uygulama rolleri parolasız oluşturulur; bootstrap-roles LOGIN + parola ekler.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'servisapp_api') then
    create role servisapp_api nologin nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'servisapp_worker') then
    create role servisapp_worker nologin nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
  end if;
  -- SECURITY DEFINER fonksiyonların sahibi: BYPASSRLS yok, superuser değil.
  if not exists (select 1 from pg_roles where rolname = 'servisapp_definer') then
    create role servisapp_definer nologin nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
  end if;
end
$$;

create type trip_state as enum (
  'PLANNED', 'READY', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'SUSPENDED', 'ABORTED', 'AUTO_CLOSED'
);
create type student_state as enum (
  'EXPECTED', 'ON_BOARD', 'DELIVERED', 'ABSENT_PLANNED', 'NO_SHOW', 'MOVED_OUT',
  'DELIVERY_FAILED', 'DELIVERED_LATE', 'RETURNED_TO_SCHOOL', 'HANDED_TO_ADMIN', 'RETURNED_HOME'
);
create type delivery_target as enum ('SCHOOL', 'HOME', 'TEMP');
create type delivery_method as enum ('HOME_NO_CODE', 'OTP', 'ADMIN_OVERRIDE');
create type membership_role_name as enum ('ADMIN', 'DRIVER', 'ATTENDANT', 'GUARDIAN');
create type actor_role as enum ('ADMIN', 'DRIVER', 'ATTENDANT', 'GUARDIAN', 'SYSTEM');
create type crew_role as enum ('DRIVER', 'ATTENDANT');
create type trip_segment as enum ('MORNING', 'AFTERNOON');
create type stop_kind as enum ('PICKUP', 'DROPOFF', 'SCHOOL');
create type address_usage as enum ('PICKUP', 'DROPOFF');
create type school_level as enum ('PRESCHOOL', 'PRIMARY', 'SECONDARY', 'HIGH');
create type handover_policy as enum ('GUARDIAN_REQUIRED', 'MAY_LEAVE_ALONE');
create type route_version_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
create type calendar_day_type as enum ('SCHOOL_DAY', 'HOLIDAY', 'HALF_DAY');
create type delivery_override_status as enum (
  'PENDING_APPROVAL', 'ACTIVE', 'VERIFIED', 'CANCELLED', 'EXPIRED', 'LOCKED'
);
create type command_status as enum ('PENDING', 'APPLIED', 'CONFLICT', 'REJECTED');
create type trip_student_origin as enum ('FROM_ROUTE', 'MOVED_IN', 'ADDED_BY_ADMIN');
create type vehicle_check_phase as enum ('BEFORE', 'AFTER');
create type location_quality as enum ('GOOD', 'LOW', 'REJECTED');
create type exception_source as enum ('PARENT', 'STAFF', 'ADMIN');
create type request_status as enum ('PENDING', 'APPROVED', 'REJECTED');
create type notification_channel as enum ('PUSH', 'SMS');
create type notification_status as enum ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');
create type membership_status as enum ('ACTIVE', 'INVITED', 'SUSPENDED', 'REVOKED');
create type device_platform as enum ('IOS', 'ANDROID');
create type alert_severity as enum ('INFO', 'WARNING', 'CRITICAL');

create table tenant (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/Istanbul',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table identity (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  phone_e164 text not null unique,
  email text,
  full_name text not null,
  created_at timestamptz not null default now(),
  constraint identity_phone_e164 check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
create unique index identity_auth_user_id_key on identity (auth_user_id) where auth_user_id is not null;
create unique index identity_email_key on identity (email) where email is not null;

create table tenant_membership (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  identity_id uuid not null references identity (id),
  status membership_status not null default 'INVITED',
  created_at timestamptz not null default now(),
  unique (tenant_id, identity_id),
  unique (tenant_id, id)
);

create table membership_role (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  membership_id uuid not null,
  role membership_role_name not null,
  scope_id uuid,
  foreign key (tenant_id, membership_id) references tenant_membership (tenant_id, id)
);
create unique index membership_role_unique
  on membership_role (membership_id, role, scope_id) nulls not distinct;

create table device (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  membership_id uuid not null,
  platform device_platform not null,
  push_token text,
  app_version text,
  last_sync_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, membership_id) references tenant_membership (tenant_id, id)
);

create table address (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  "text" text not null,
  il text not null,
  ilce text not null,
  lat double precision not null,
  lng double precision not null,
  geocode_confidence real,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint address_lat check (lat between -90 and 90),
  constraint address_lng check (lng between -180 and 180)
);

create table stop (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  address_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  label text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, address_id) references address (tenant_id, id),
  constraint stop_lat check (lat between -90 and 90),
  constraint stop_lng check (lng between -180 and 180)
);

create table school (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  name text not null,
  level school_level not null,
  address_id uuid not null,
  attendant_required boolean not null default true,
  unique (tenant_id, id),
  foreign key (tenant_id, address_id) references address (tenant_id, id)
);

create table vehicle (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  plate text not null,
  seat_count integer not null,
  model_year smallint,
  inspection_expiry date,
  insurance_expiry date,
  unique (tenant_id, plate),
  unique (tenant_id, id),
  constraint vehicle_seat_count check (seat_count > 0)
);

create table staff_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  vehicle_id uuid not null,
  membership_id uuid not null,
  role crew_role not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  foreign key (tenant_id, vehicle_id) references vehicle (tenant_id, id),
  foreign key (tenant_id, membership_id) references tenant_membership (tenant_id, id)
);

create table student (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  school_id uuid not null,
  full_name text not null,
  grade text,
  photo_path text,
  handover_policy handover_policy not null,
  enrollment_start date not null,
  enrollment_end date,
  unique (tenant_id, id),
  foreign key (tenant_id, school_id) references school (tenant_id, id)
);

create table student_guardian (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  student_id uuid not null,
  guardian_membership_id uuid not null,
  relation text not null,
  is_primary boolean not null default false,
  can_receive_child boolean not null default true,
  can_authorize_temp_address boolean not null default false,
  can_submit_exception boolean not null default true,
  notify_am boolean not null default true,
  notify_pm boolean not null default true,
  unique (tenant_id, student_id, guardian_membership_id),
  foreign key (tenant_id, student_id) references student (tenant_id, id),
  foreign key (tenant_id, guardian_membership_id) references tenant_membership (tenant_id, id)
);

create table student_address (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  student_id uuid not null,
  address_id uuid not null,
  usage address_usage not null,
  valid_from date not null,
  valid_to date,
  foreign key (tenant_id, student_id) references student (tenant_id, id),
  foreign key (tenant_id, address_id) references address (tenant_id, id)
);

create table route (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  vehicle_id uuid not null,
  school_id uuid not null,
  segment trip_segment not null,
  shift_no smallint not null default 1,
  max_detour_m integer not null default 1500,
  unique (tenant_id, vehicle_id, segment, shift_no),
  unique (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references vehicle (tenant_id, id),
  foreign key (tenant_id, school_id) references school (tenant_id, id),
  constraint route_shift_no check (shift_no >= 1)
);

create table route_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  route_id uuid not null,
  version_no integer not null,
  status route_version_status not null default 'DRAFT',
  effective_from date not null,
  unique (tenant_id, route_id, version_no),
  unique (tenant_id, id),
  foreign key (tenant_id, route_id) references route (tenant_id, id)
);

create table route_stop (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  route_version_id uuid not null,
  stop_id uuid not null,
  seq integer not null,
  kind stop_kind not null,
  unique (route_version_id, seq),
  unique (tenant_id, id),
  foreign key (tenant_id, route_version_id) references route_version (tenant_id, id),
  foreign key (tenant_id, stop_id) references stop (tenant_id, id)
);

create table route_stop_student (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  route_stop_id uuid not null,
  student_id uuid not null,
  unique (route_stop_id, student_id),
  foreign key (tenant_id, route_stop_id) references route_stop (tenant_id, id),
  foreign key (tenant_id, student_id) references student (tenant_id, id)
);

create table school_calendar_day (
  tenant_id uuid not null references tenant (id),
  school_id uuid not null,
  date date not null,
  type calendar_day_type not null,
  pm_departure_override text,
  unique (tenant_id, school_id, date),
  foreign key (tenant_id, school_id) references school (tenant_id, id)
);

create table stop_travel_time_cache (
  tenant_id uuid not null references tenant (id),
  from_stop_id uuid not null,
  to_stop_id uuid not null,
  seconds integer not null,
  meters integer not null,
  computed_at timestamptz not null default now(),
  unique (tenant_id, from_stop_id, to_stop_id),
  foreign key (tenant_id, from_stop_id) references stop (tenant_id, id),
  foreign key (tenant_id, to_stop_id) references stop (tenant_id, id)
);

create table route_segment_stat (
  tenant_id uuid not null references tenant (id),
  route_id uuid not null,
  from_stop_id uuid not null,
  to_stop_id uuid not null,
  weekday smallint not null,
  time_bucket smallint not null,
  sample_count integer not null default 0,
  avg_seconds integer,
  median_seconds integer,
  p75_seconds integer,
  updated_at timestamptz not null default now(),
  unique (tenant_id, route_id, from_stop_id, to_stop_id, weekday, time_bucket),
  foreign key (tenant_id, route_id) references route (tenant_id, id),
  constraint route_segment_stat_weekday check (weekday between 0 and 6)
);
create index route_segment_stat_route_idx on route_segment_stat (tenant_id, route_id);

create table trip (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  route_id uuid not null,
  route_version_id uuid not null,
  service_date date not null,
  segment trip_segment not null,
  state trip_state not null default 'PLANNED',
  planned_departure_at timestamptz not null,
  actual_started_at timestamptz,
  actual_completed_at timestamptz,
  current_vehicle_id uuid not null,
  current_driver_membership_id uuid not null,
  current_attendant_membership_id uuid,
  cancel_reason text,
  location_source_device_id uuid,
  location_session_epoch integer not null default 0,
  route_baseline jsonb,
  baseline_computed_at timestamptz,
  routes_calls_count integer not null default 0,
  last_routes_call_at timestamptz,
  unique (tenant_id, route_id, service_date),
  unique (tenant_id, id),
  foreign key (tenant_id, route_id) references route (tenant_id, id),
  foreign key (tenant_id, route_version_id) references route_version (tenant_id, id),
  foreign key (tenant_id, current_vehicle_id) references vehicle (tenant_id, id),
  foreign key (tenant_id, current_driver_membership_id) references tenant_membership (tenant_id, id),
  foreign key (tenant_id, current_attendant_membership_id) references tenant_membership (tenant_id, id),
  foreign key (tenant_id, location_source_device_id) references device (tenant_id, id)
);
create index trip_service_date_idx on trip (tenant_id, service_date, state);

create table trip_stop (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  trip_id uuid not null,
  seq numeric(12, 4) not null,
  kind stop_kind not null,
  source_stop_id uuid,
  snapshot_lat double precision not null,
  snapshot_lng double precision not null,
  snapshot_label text not null,
  snapshot_address_text text not null,
  planned_eta timestamptz,
  actual_arrived_at timestamptz,
  unique (tenant_id, trip_id, seq),
  unique (tenant_id, id),
  foreign key (tenant_id, trip_id) references trip (tenant_id, id),
  foreign key (tenant_id, source_stop_id) references stop (tenant_id, id) on delete set null,
  constraint trip_stop_lat check (snapshot_lat between -90 and 90),
  constraint trip_stop_lng check (snapshot_lng between -180 and 180)
);

create table trip_stop_student (
  tenant_id uuid not null references tenant (id),
  trip_stop_id uuid not null,
  student_id uuid not null,
  unique (tenant_id, trip_stop_id, student_id),
  foreign key (tenant_id, trip_stop_id) references trip_stop (tenant_id, id),
  foreign key (tenant_id, student_id) references student (tenant_id, id)
);

create table delivery_override (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  student_id uuid not null,
  service_date date not null,
  address_id uuid not null,
  receiver_name text not null,
  receiver_phone text not null,
  otp_hmac bytea,
  otp_ciphertext bytea,
  otp_expires_at timestamptz,
  attempt_count integer not null default 0,
  locked_until timestamptz,
  resend_count integer not null default 0,
  verified_at timestamptz,
  verified_by uuid,
  status delivery_override_status not null default 'PENDING_APPROVAL',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references student (tenant_id, id),
  foreign key (tenant_id, address_id) references address (tenant_id, id),
  foreign key (tenant_id, verified_by) references tenant_membership (tenant_id, id)
);
create unique index delivery_override_active
  on delivery_override (tenant_id, student_id, service_date)
  where status in ('PENDING_APPROVAL', 'ACTIVE', 'LOCKED');

create table trip_student (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  trip_id uuid not null,
  student_id uuid not null,
  state student_state not null default 'EXPECTED',
  state_seq integer not null default 0,
  state_changed_at timestamptz not null default now(),
  delivery_target delivery_target not null,
  expected_stop_id uuid,
  actual_stop_id uuid,
  snapshot_dropoff_lat double precision,
  snapshot_dropoff_lng double precision,
  snapshot_dropoff_text text,
  boarded_at timestamptz,
  boarded_lat double precision,
  boarded_lng double precision,
  origin trip_student_origin not null default 'FROM_ROUTE',
  counterpart_trip_student_id uuid,
  needs_review boolean not null default false,
  delivery_method delivery_method,
  delivery_verified_at timestamptz,
  delivery_override_id uuid,
  receiver_name text,
  eta_seconds integer,
  eta_confidence real,
  eta_computed_at timestamptz,
  approach_notified_at timestamptz,
  unique (tenant_id, trip_id, student_id),
  unique (tenant_id, id),
  foreign key (tenant_id, trip_id) references trip (tenant_id, id),
  foreign key (tenant_id, student_id) references student (tenant_id, id),
  foreign key (tenant_id, expected_stop_id) references trip_stop (tenant_id, id),
  foreign key (tenant_id, actual_stop_id) references trip_stop (tenant_id, id),
  foreign key (tenant_id, counterpart_trip_student_id) references trip_student (tenant_id, id),
  foreign key (tenant_id, delivery_override_id) references delivery_override (tenant_id, id),
  constraint temp_delivery_requires_verification check (
    state not in ('DELIVERED', 'DELIVERED_LATE')
    or delivery_target <> 'TEMP'
    or (delivery_method in ('OTP', 'ADMIN_OVERRIDE') and delivery_verified_at is not null)
  ),
  constraint trip_student_eta_confidence check (
    eta_confidence is null or (eta_confidence >= 0 and eta_confidence <= 1)
  )
);
create index trip_student_state_idx on trip_student (tenant_id, trip_id, state);

create table trip_vehicle_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  trip_id uuid not null,
  vehicle_id uuid not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  reason text,
  foreign key (tenant_id, trip_id) references trip (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references vehicle (tenant_id, id)
);

create table trip_crew_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  trip_id uuid not null,
  membership_id uuid not null,
  role crew_role not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  reason text,
  foreign key (tenant_id, trip_id) references trip (tenant_id, id),
  foreign key (tenant_id, membership_id) references tenant_membership (tenant_id, id)
);

create table trip_vehicle_check (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  trip_id uuid not null,
  phase vehicle_check_phase not null,
  checked_by uuid not null,
  vehicle_empty_confirmed boolean not null,
  at timestamptz not null default now(),
  unique (tenant_id, trip_id, phase),
  foreign key (tenant_id, trip_id) references trip (tenant_id, id),
  foreign key (tenant_id, checked_by) references tenant_membership (tenant_id, id)
);

create table ride_exception (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  student_id uuid not null,
  service_date date not null,
  segment trip_segment not null,
  created_by_membership_id uuid not null,
  source exception_source not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, student_id) references student (tenant_id, id),
  foreign key (tenant_id, created_by_membership_id) references tenant_membership (tenant_id, id)
);
create unique index ride_exception_active
  on ride_exception (tenant_id, student_id, service_date, segment)
  where cancelled_at is null;

create table student_trip_move (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  student_id uuid not null,
  service_date date not null,
  segment trip_segment not null,
  target_route_id uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, student_id, service_date, segment),
  foreign key (tenant_id, student_id) references student (tenant_id, id),
  foreign key (tenant_id, target_route_id) references route (tenant_id, id)
);

create table address_change_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  student_id uuid not null,
  proposed_address_id uuid not null,
  status request_status not null default 'PENDING',
  effective_from_date date not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, student_id) references student (tenant_id, id),
  foreign key (tenant_id, proposed_address_id) references address (tenant_id, id)
);

create table vehicle_current_location (
  tenant_id uuid not null references tenant (id),
  vehicle_id uuid not null,
  trip_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  speed real,
  heading real,
  accuracy_m real,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  source_device_id uuid not null,
  session_epoch integer not null,
  quality location_quality not null,
  is_stale boolean not null default false,
  unique (tenant_id, vehicle_id),
  foreign key (tenant_id, vehicle_id) references vehicle (tenant_id, id),
  foreign key (tenant_id, trip_id) references trip (tenant_id, id),
  foreign key (tenant_id, source_device_id) references device (tenant_id, id),
  constraint vehicle_current_location_lat check (lat between -90 and 90),
  constraint vehicle_current_location_lng check (lng between -180 and 180)
);

create table vehicle_location_ping (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  vehicle_id uuid not null,
  trip_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  speed real,
  heading real,
  accuracy_m real,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  source_device_id uuid not null,
  session_epoch integer not null,
  quality location_quality not null,
  primary key (id, recorded_at),
  foreign key (tenant_id, trip_id) references trip (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references vehicle (tenant_id, id),
  constraint vehicle_location_ping_lat check (lat between -90 and 90),
  constraint vehicle_location_ping_lng check (lng between -180 and 180)
) partition by range (recorded_at);

create table vehicle_location_ping_default partition of vehicle_location_ping default;

create table critical_change_alert (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  trip_id uuid not null,
  severity alert_severity not null,
  body text not null,
  requires_ack_roles text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, trip_id) references trip (tenant_id, id)
);

create table critical_change_ack (
  tenant_id uuid not null references tenant (id),
  alert_id uuid not null,
  membership_id uuid not null,
  device_id uuid not null,
  acked_at timestamptz not null default now(),
  unique (tenant_id, alert_id, membership_id),
  foreign key (tenant_id, alert_id) references critical_change_alert (tenant_id, id)
);

create table notification (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant (id),
  recipient_membership_id uuid not null,
  channel notification_channel not null,
  type text not null,
  trip_id uuid,
  student_id uuid,
  status notification_status not null default 'QUEUED',
  sent_at timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key),
  foreign key (tenant_id, recipient_membership_id) references tenant_membership (tenant_id, id)
);

create table event (
  seq bigint generated always as identity,
  tenant_id uuid not null references tenant (id),
  occurred_at_server timestamptz not null default now(),
  occurred_at_device timestamptz,
  actor_membership_id uuid,
  actor_role actor_role,
  device_id uuid,
  vehicle_id uuid,
  trip_id uuid,
  subject_type text not null,
  subject_id uuid not null,
  event_type text not null,
  prev_state text,
  new_state text,
  lat double precision,
  lng double precision,
  payload jsonb not null default '{}'::jsonb,
  source_command_id uuid,
  is_undo_of_event_id bigint,
  app_version text,
  late_arrival boolean not null default false,
  primary key (seq, occurred_at_server),
  foreign key (tenant_id, actor_membership_id) references tenant_membership (tenant_id, id),
  foreign key (tenant_id, device_id) references device (tenant_id, id),
  foreign key (tenant_id, trip_id) references trip (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references vehicle (tenant_id, id)
) partition by range (occurred_at_server);

create table event_default partition of event default;

create table command_receipt (
  tenant_id uuid not null references tenant (id),
  client_event_id uuid not null,
  device_id uuid not null,
  device_seq integer,
  command_type text not null,
  status command_status not null default 'PENDING',
  response_json jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, client_event_id)
);

create table pending_command_dependency (
  tenant_id uuid not null references tenant (id),
  client_event_id uuid not null,
  target_client_event_id uuid not null,
  command_type text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, client_event_id)
);
create index pending_command_dependency_target_idx
  on pending_command_dependency (tenant_id, target_client_event_id);
