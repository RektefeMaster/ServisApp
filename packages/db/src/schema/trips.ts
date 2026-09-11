import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  crewRoleEnum,
  deliveryMethodEnum,
  deliveryTargetEnum,
  segmentEnum,
  stopKindEnum,
  studentStateEnum,
  tripStateEnum,
  tripStudentOriginEnum,
  vehicleCheckPhaseEnum,
} from './enums.js';
import { tenantIsolation, tenantRowUnique } from './helpers.js';
import { device, tenant, tenantMembership } from './identity.js';
import { deliveryOverride } from './overrides.js';
import { route, routeVersion, stop, student, vehicle } from './persistent.js';

export const trip = pgTable(
  'trip',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    routeId: uuid('route_id').notNull(),
    routeVersionId: uuid('route_version_id').notNull(),
    serviceDate: date('service_date').notNull(),
    segment: segmentEnum('segment').notNull(),
    state: tripStateEnum('state').notNull().default('PLANNED'),
    plannedDepartureAt: timestamp('planned_departure_at', { withTimezone: true }).notNull(),
    actualStartedAt: timestamp('actual_started_at', { withTimezone: true }),
    actualCompletedAt: timestamp('actual_completed_at', { withTimezone: true }),
    currentVehicleId: uuid('current_vehicle_id').notNull(),
    currentDriverMembershipId: uuid('current_driver_membership_id'),
    currentAttendantMembershipId: uuid('current_attendant_membership_id'),
    cancelReason: text('cancel_reason'),
    locationSourceDeviceId: uuid('location_source_device_id'),
    locationSessionEpoch: integer('location_session_epoch').notNull().default(0),
    routeBaseline: jsonb('route_baseline'),
    baselineComputedAt: timestamp('baseline_computed_at', { withTimezone: true }),
    routesCallsCount: integer('routes_calls_count').notNull().default(0),
    lastRoutesCallAt: timestamp('last_routes_call_at', { withTimezone: true }),
  },
  (t) => [
    unique('trip_route_date').on(t.tenantId, t.routeId, t.serviceDate),
    tenantRowUnique('trip', t.tenantId, t.id),
    foreignKey({
      name: 'trip_route_fk',
      columns: [t.tenantId, t.routeId],
      foreignColumns: [route.tenantId, route.id],
    }),
    foreignKey({
      name: 'trip_route_version_fk',
      columns: [t.tenantId, t.routeVersionId],
      foreignColumns: [routeVersion.tenantId, routeVersion.id],
    }),
    foreignKey({
      name: 'trip_vehicle_fk',
      columns: [t.tenantId, t.currentVehicleId],
      foreignColumns: [vehicle.tenantId, vehicle.id],
    }),
    foreignKey({
      name: 'trip_driver_fk',
      columns: [t.tenantId, t.currentDriverMembershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    foreignKey({
      name: 'trip_attendant_fk',
      columns: [t.tenantId, t.currentAttendantMembershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    foreignKey({
      name: 'trip_location_device_fk',
      columns: [t.tenantId, t.locationSourceDeviceId],
      foreignColumns: [device.tenantId, device.id],
    }),
    index('trip_service_date_idx').on(t.tenantId, t.serviceDate, t.state),
    tenantIsolation('trip'),
  ],
).enableRLS();

/**
 * Sefer kendi durak kopyasını taşır. Operasyon `snapshot_*` kolonlarını kullanır;
 * `source_stop_id` yalnız köken bilgisidir. Sefer ACTIVE olduktan sonra `stop` /
 * `address` / `route` tablolarına bakılmadan tamamlanabilmelidir.
 */
export const tripStop = pgTable(
  'trip_stop',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    tripId: uuid('trip_id').notNull(),
    seq: numeric('seq', { precision: 12, scale: 4 }).notNull(),
    kind: stopKindEnum('kind').notNull(),
    sourceStopId: uuid('source_stop_id'),
    snapshotLat: doublePrecision('snapshot_lat').notNull(),
    snapshotLng: doublePrecision('snapshot_lng').notNull(),
    snapshotLabel: text('snapshot_label').notNull(),
    snapshotAddressText: text('snapshot_address_text').notNull(),
    plannedEta: timestamp('planned_eta', { withTimezone: true }),
    actualArrivedAt: timestamp('actual_arrived_at', { withTimezone: true }),
  },
  (t) => [
    unique('trip_stop_seq').on(t.tenantId, t.tripId, t.seq),
    tenantRowUnique('trip_stop', t.tenantId, t.id),
    foreignKey({
      name: 'trip_stop_trip_fk',
      columns: [t.tenantId, t.tripId],
      foreignColumns: [trip.tenantId, trip.id],
    }),
    foreignKey({
      name: 'trip_stop_source_fk',
      columns: [t.tenantId, t.sourceStopId],
      foreignColumns: [stop.tenantId, stop.id],
    }).onDelete('set null'),
    check('trip_stop_lat', sql`${t.snapshotLat} between -90 and 90`),
    check('trip_stop_lng', sql`${t.snapshotLng} between -180 and 180`),
    tenantIsolation('trip_stop'),
  ],
).enableRLS();

export const tripStopStudent = pgTable(
  'trip_stop_student',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    tripStopId: uuid('trip_stop_id').notNull(),
    studentId: uuid('student_id').notNull(),
  },
  (t) => [
    unique('trip_stop_student_pk').on(t.tenantId, t.tripStopId, t.studentId),
    foreignKey({
      name: 'trip_stop_student_stop_fk',
      columns: [t.tenantId, t.tripStopId],
      foreignColumns: [tripStop.tenantId, tripStop.id],
    }),
    foreignKey({
      name: 'trip_stop_student_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
    }),
    tenantIsolation('trip_stop_student'),
  ],
).enableRLS();

export const tripStudent = pgTable(
  'trip_student',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    tripId: uuid('trip_id').notNull(),
    studentId: uuid('student_id').notNull(),
    state: studentStateEnum('state').notNull().default('EXPECTED'),
    stateSeq: integer('state_seq').notNull().default(0),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    deliveryTarget: deliveryTargetEnum('delivery_target').notNull(),
    expectedStopId: uuid('expected_stop_id'),
    actualStopId: uuid('actual_stop_id'),
    snapshotDropoffLat: doublePrecision('snapshot_dropoff_lat'),
    snapshotDropoffLng: doublePrecision('snapshot_dropoff_lng'),
    snapshotDropoffText: text('snapshot_dropoff_text'),
    boardedAt: timestamp('boarded_at', { withTimezone: true }),
    boardedLat: doublePrecision('boarded_lat'),
    boardedLng: doublePrecision('boarded_lng'),
    origin: tripStudentOriginEnum('origin').notNull().default('FROM_ROUTE'),
    counterpartTripStudentId: uuid('counterpart_trip_student_id'),
    needsReview: boolean('needs_review').notNull().default(false),
    deliveryMethod: deliveryMethodEnum('delivery_method'),
    deliveryVerifiedAt: timestamp('delivery_verified_at', { withTimezone: true }),
    deliveryOverrideId: uuid('delivery_override_id'),
    receiverName: text('receiver_name'),
    etaSeconds: integer('eta_seconds'),
    etaConfidence: real('eta_confidence'),
    etaComputedAt: timestamp('eta_computed_at', { withTimezone: true }),
    approachNotifiedAt: timestamp('approach_notified_at', { withTimezone: true }),
  },
  (t) => [
    unique('trip_student_unique').on(t.tenantId, t.tripId, t.studentId),
    tenantRowUnique('trip_student', t.tenantId, t.id),
    foreignKey({
      name: 'trip_student_trip_fk',
      columns: [t.tenantId, t.tripId],
      foreignColumns: [trip.tenantId, trip.id],
    }),
    foreignKey({
      name: 'trip_student_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
    }),
    foreignKey({
      name: 'trip_student_expected_stop_fk',
      columns: [t.tenantId, t.expectedStopId],
      foreignColumns: [tripStop.tenantId, tripStop.id],
    }),
    foreignKey({
      name: 'trip_student_actual_stop_fk',
      columns: [t.tenantId, t.actualStopId],
      foreignColumns: [tripStop.tenantId, tripStop.id],
    }),
    foreignKey({
      name: 'trip_student_override_fk',
      columns: [t.tenantId, t.deliveryOverrideId],
      foreignColumns: [deliveryOverride.tenantId, deliveryOverride.id],
    }),
    foreignKey({
      name: 'trip_student_counterpart_fk',
      columns: [t.tenantId, t.counterpartTripStudentId],
      foreignColumns: [t.tenantId, t.id],
    }),
    check(
      'temp_delivery_requires_verification',
      sql`${t.state} not in ('DELIVERED', 'DELIVERED_LATE', 'RETURNED_HOME')
        or ${t.deliveryTarget} <> 'TEMP'
        or (${t.deliveryMethod} in ('OTP', 'ADMIN_OVERRIDE') and ${t.deliveryVerifiedAt} is not null)`,
    ),
    check(
      'trip_student_eta_confidence',
      sql`${t.etaConfidence} is null or (${t.etaConfidence} >= 0 and ${t.etaConfidence} <= 1)`,
    ),
    index('trip_student_state_idx').on(t.tenantId, t.tripId, t.state),
    tenantIsolation('trip_student'),
  ],
).enableRLS();

export const tripVehicleAssignment = pgTable(
  'trip_vehicle_assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    tripId: uuid('trip_id').notNull(),
    vehicleId: uuid('vehicle_id').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    reason: text('reason'),
  },
  (t) => [
    foreignKey({
      name: 'trip_vehicle_assignment_trip_fk',
      columns: [t.tenantId, t.tripId],
      foreignColumns: [trip.tenantId, trip.id],
    }),
    foreignKey({
      name: 'trip_vehicle_assignment_vehicle_fk',
      columns: [t.tenantId, t.vehicleId],
      foreignColumns: [vehicle.tenantId, vehicle.id],
    }),
    tenantIsolation('trip_vehicle_assignment'),
    index('trip_vehicle_assignment_open_idx')
      .on(t.tenantId, t.tripId)
      .where(sql`${t.validTo} is null`),
  ],
).enableRLS();

export const tripCrewAssignment = pgTable(
  'trip_crew_assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    tripId: uuid('trip_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    role: crewRoleEnum('role').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    reason: text('reason'),
  },
  (t) => [
    foreignKey({
      name: 'trip_crew_assignment_trip_fk',
      columns: [t.tenantId, t.tripId],
      foreignColumns: [trip.tenantId, trip.id],
    }),
    foreignKey({
      name: 'trip_crew_assignment_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    tenantIsolation('trip_crew_assignment'),
    index('trip_crew_assignment_open_idx')
      .on(t.tenantId, t.tripId, t.role)
      .where(sql`${t.validTo} is null`),
  ],
).enableRLS();

export const tripVehicleCheck = pgTable(
  'trip_vehicle_check',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    tripId: uuid('trip_id').notNull(),
    phase: vehicleCheckPhaseEnum('phase').notNull(),
    checkedBy: uuid('checked_by').notNull(),
    vehicleEmptyConfirmed: boolean('vehicle_empty_confirmed').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('trip_vehicle_check_phase').on(t.tenantId, t.tripId, t.phase),
    foreignKey({
      name: 'trip_vehicle_check_trip_fk',
      columns: [t.tenantId, t.tripId],
      foreignColumns: [trip.tenantId, trip.id],
    }),
    foreignKey({
      name: 'trip_vehicle_check_membership_fk',
      columns: [t.tenantId, t.checkedBy],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }),
    tenantIsolation('trip_vehicle_check'),
  ],
).enableRLS();
