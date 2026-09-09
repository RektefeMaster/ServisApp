import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  addressUsageEnum,
  calendarDayTypeEnum,
  crewRoleEnum,
  handoverPolicyEnum,
  routeVersionStatusEnum,
  schoolLevelEnum,
  segmentEnum,
  stopKindEnum,
} from './enums.js';
import { tenantIsolation, tenantRowUnique } from './helpers.js';
import { tenant, tenantMembership } from './identity.js';

/** Append-only. Adres değişmez; yeni satır eklenir. */
export const address = pgTable(
  'address',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    text: text('text').notNull(),
    il: text('il').notNull(),
    ilce: text('ilce').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    geocodeConfidence: real('geocode_confidence'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantRowUnique('address', t.tenantId, t.id),
    check('address_lat', sql`${t.lat} between -90 and 90`),
    check('address_lng', sql`${t.lng} between -180 and 180`),
    tenantIsolation('address'),
  ],
).enableRLS();

/** Aracın durduğu nokta — kapı adresi değil. */
export const stop = pgTable(
  'stop',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    addressId: uuid('address_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    label: text('label').notNull(),
  },
  (t) => [
    tenantRowUnique('stop', t.tenantId, t.id),
    foreignKey({
      name: 'stop_address_fk',
      columns: [t.tenantId, t.addressId],
      foreignColumns: [address.tenantId, address.id],
    }),
    check('stop_lat', sql`${t.lat} between -90 and 90`),
    check('stop_lng', sql`${t.lng} between -180 and 180`),
    tenantIsolation('stop'),
  ],
).enableRLS();

export const school = pgTable(
  'school',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    name: text('name').notNull(),
    level: schoolLevelEnum('level').notNull(),
    addressId: uuid('address_id').notNull(),
    attendantRequired: boolean('attendant_required').notNull().default(true),
  },
  (t) => [
    tenantRowUnique('school', t.tenantId, t.id),
    foreignKey({
      name: 'school_address_fk',
      columns: [t.tenantId, t.addressId],
      foreignColumns: [address.tenantId, address.id],
    }),
    tenantIsolation('school'),
  ],
).enableRLS();

export const vehicle = pgTable(
  'vehicle',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    plate: text('plate').notNull(),
    seatCount: integer('seat_count').notNull(),
    modelYear: smallint('model_year'),
    inspectionExpiry: date('inspection_expiry'),
    insuranceExpiry: date('insurance_expiry'),
  },
  (t) => [
    unique('vehicle_plate').on(t.tenantId, t.plate),
    tenantRowUnique('vehicle', t.tenantId, t.id),
    check('vehicle_seat_count', sql`${t.seatCount} > 0`),
    tenantIsolation('vehicle'),
  ],
).enableRLS();

export const staffAssignment = pgTable(
  'staff_assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    vehicleId: uuid('vehicle_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    role: crewRoleEnum('role').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'staff_assignment_vehicle_fk',
      columns: [t.tenantId, t.vehicleId],
      foreignColumns: [vehicle.tenantId, vehicle.id],
    }),
    foreignKey({
      name: 'staff_assignment_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    tenantIsolation('staff_assignment'),
  ],
).enableRLS();

export const student = pgTable(
  'student',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    schoolId: uuid('school_id').notNull(),
    fullName: text('full_name').notNull(),
    grade: text('grade'),
    photoPath: text('photo_path'),
    handoverPolicy: handoverPolicyEnum('handover_policy').notNull(),
    enrollmentStart: date('enrollment_start').notNull(),
    enrollmentEnd: date('enrollment_end'),
  },
  (t) => [
    tenantRowUnique('student', t.tenantId, t.id),
    foreignKey({
      name: 'student_school_fk',
      columns: [t.tenantId, t.schoolId],
      foreignColumns: [school.tenantId, school.id],
    }),
    tenantIsolation('student'),
  ],
).enableRLS();

export const studentGuardian = pgTable(
  'student_guardian',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    studentId: uuid('student_id').notNull(),
    guardianMembershipId: uuid('guardian_membership_id').notNull(),
    relation: text('relation').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    canReceiveChild: boolean('can_receive_child').notNull().default(true),
    canAuthorizeTempAddress: boolean('can_authorize_temp_address').notNull().default(false),
    canSubmitException: boolean('can_submit_exception').notNull().default(true),
    notifyAm: boolean('notify_am').notNull().default(true),
    notifyPm: boolean('notify_pm').notNull().default(true),
  },
  (t) => [
    unique('student_guardian_pair').on(t.tenantId, t.studentId, t.guardianMembershipId),
    foreignKey({
      name: 'student_guardian_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
    }),
    foreignKey({
      name: 'student_guardian_membership_fk',
      columns: [t.tenantId, t.guardianMembershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    tenantIsolation('student_guardian'),
  ],
).enableRLS();

export const studentAddress = pgTable(
  'student_address',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    studentId: uuid('student_id').notNull(),
    addressId: uuid('address_id').notNull(),
    usage: addressUsageEnum('usage').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
  },
  (t) => [
    foreignKey({
      name: 'student_address_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
    }),
    foreignKey({
      name: 'student_address_address_fk',
      columns: [t.tenantId, t.addressId],
      foreignColumns: [address.tenantId, address.id],
    }),
    tenantIsolation('student_address'),
  ],
).enableRLS();

export const route = pgTable(
  'route',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    vehicleId: uuid('vehicle_id').notNull(),
    schoolId: uuid('school_id').notNull(),
    segment: segmentEnum('segment').notNull(),
    shiftNo: smallint('shift_no').notNull().default(1),
    maxDetourM: integer('max_detour_m').notNull().default(1500),
  },
  (t) => [
    unique('route_vehicle_segment_shift').on(t.tenantId, t.vehicleId, t.segment, t.shiftNo),
    tenantRowUnique('route', t.tenantId, t.id),
    foreignKey({
      name: 'route_vehicle_fk',
      columns: [t.tenantId, t.vehicleId],
      foreignColumns: [vehicle.tenantId, vehicle.id],
    }),
    foreignKey({
      name: 'route_school_fk',
      columns: [t.tenantId, t.schoolId],
      foreignColumns: [school.tenantId, school.id],
    }),
    check('route_shift_no', sql`${t.shiftNo} >= 1`),
    tenantIsolation('route'),
  ],
).enableRLS();

export const routeVersion = pgTable(
  'route_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    routeId: uuid('route_id').notNull(),
    versionNo: integer('version_no').notNull(),
    status: routeVersionStatusEnum('status').notNull().default('DRAFT'),
    effectiveFrom: date('effective_from').notNull(),
  },
  (t) => [
    unique('route_version_no').on(t.tenantId, t.routeId, t.versionNo),
    tenantRowUnique('route_version', t.tenantId, t.id),
    uniqueIndex('route_version_one_published')
      .on(t.tenantId, t.routeId)
      .where(sql`${t.status} = 'PUBLISHED'`),
    uniqueIndex('route_version_one_draft')
      .on(t.tenantId, t.routeId)
      .where(sql`${t.status} = 'DRAFT'`),
    foreignKey({
      name: 'route_version_route_fk',
      columns: [t.tenantId, t.routeId],
      foreignColumns: [route.tenantId, route.id],
    }),
    tenantIsolation('route_version'),
  ],
).enableRLS();

export const routeStop = pgTable(
  'route_stop',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    routeVersionId: uuid('route_version_id').notNull(),
    stopId: uuid('stop_id').notNull(),
    seq: integer('seq').notNull(),
    kind: stopKindEnum('kind').notNull(),
  },
  (t) => [
    unique('route_stop_seq').on(t.routeVersionId, t.seq),
    unique('route_stop_stop').on(t.tenantId, t.routeVersionId, t.stopId),
    tenantRowUnique('route_stop', t.tenantId, t.id),
    check('route_stop_seq_positive', sql`${t.seq} >= 1`),
    foreignKey({
      name: 'route_stop_version_fk',
      columns: [t.tenantId, t.routeVersionId],
      foreignColumns: [routeVersion.tenantId, routeVersion.id],
    }),
    foreignKey({
      name: 'route_stop_stop_fk',
      columns: [t.tenantId, t.stopId],
      foreignColumns: [stop.tenantId, stop.id],
    }),
    tenantIsolation('route_stop'),
  ],
).enableRLS();

export const routeStopStudent = pgTable(
  'route_stop_student',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    routeStopId: uuid('route_stop_id').notNull(),
    studentId: uuid('student_id').notNull(),
  },
  (t) => [
    unique('route_stop_student_pair').on(t.routeStopId, t.studentId),
    foreignKey({
      name: 'route_stop_student_stop_fk',
      columns: [t.tenantId, t.routeStopId],
      foreignColumns: [routeStop.tenantId, routeStop.id],
    }),
    foreignKey({
      name: 'route_stop_student_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
    }),
    tenantIsolation('route_stop_student'),
  ],
).enableRLS();

/** V1 yalnız HOLIDAY kullanır; diğer tipler şemada yer tutar. */
export const schoolCalendarDay = pgTable(
  'school_calendar_day',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    schoolId: uuid('school_id').notNull(),
    date: date('date').notNull(),
    type: calendarDayTypeEnum('type').notNull(),
    pmDepartureOverride: text('pm_departure_override'),
  },
  (t) => [
    unique('school_calendar_day_pk').on(t.tenantId, t.schoolId, t.date),
    foreignKey({
      name: 'school_calendar_day_school_fk',
      columns: [t.tenantId, t.schoolId],
      foreignColumns: [school.tenantId, school.id],
    }),
    tenantIsolation('school_calendar_day'),
  ],
).enableRLS();

export const stopTravelTimeCache = pgTable(
  'stop_travel_time_cache',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    fromStopId: uuid('from_stop_id').notNull(),
    toStopId: uuid('to_stop_id').notNull(),
    seconds: integer('seconds').notNull(),
    meters: integer('meters').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('stop_travel_time_cache_edge').on(t.tenantId, t.fromStopId, t.toStopId),
    foreignKey({
      name: 'stop_travel_time_from_fk',
      columns: [t.tenantId, t.fromStopId],
      foreignColumns: [stop.tenantId, stop.id],
    }),
    foreignKey({
      name: 'stop_travel_time_to_fk',
      columns: [t.tenantId, t.toStopId],
      foreignColumns: [stop.tenantId, stop.id],
    }),
    tenantIsolation('stop_travel_time_cache'),
  ],
).enableRLS();

export const routeSegmentStat = pgTable(
  'route_segment_stat',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    routeId: uuid('route_id').notNull(),
    fromStopId: uuid('from_stop_id').notNull(),
    toStopId: uuid('to_stop_id').notNull(),
    weekday: smallint('weekday').notNull(),
    timeBucket: smallint('time_bucket').notNull(),
    sampleCount: integer('sample_count').notNull().default(0),
    avgSeconds: integer('avg_seconds'),
    medianSeconds: integer('median_seconds'),
    p75Seconds: integer('p75_seconds'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('route_segment_stat_bucket').on(
      t.tenantId,
      t.routeId,
      t.fromStopId,
      t.toStopId,
      t.weekday,
      t.timeBucket,
    ),
    foreignKey({
      name: 'route_segment_stat_route_fk',
      columns: [t.tenantId, t.routeId],
      foreignColumns: [route.tenantId, route.id],
    }),
    check('route_segment_stat_weekday', sql`${t.weekday} between 0 and 6`),
    index('route_segment_stat_route_idx').on(t.tenantId, t.routeId),
    tenantIsolation('route_segment_stat'),
  ],
).enableRLS();
