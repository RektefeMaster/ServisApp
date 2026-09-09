import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  integer,
  pgTable,
  real,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { locationQualityEnum } from './enums.js';
import { tenantIsolation } from './helpers.js';
import { device, tenant } from './identity.js';
import { vehicle } from './persistent.js';
import { trip } from './trips.js';

export const vehicleCurrentLocation = pgTable(
  'vehicle_current_location',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    vehicleId: uuid('vehicle_id').notNull(),
    tripId: uuid('trip_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    speed: real('speed'),
    heading: real('heading'),
    accuracyM: real('accuracy_m'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    sourceDeviceId: uuid('source_device_id').notNull(),
    sessionEpoch: integer('session_epoch').notNull(),
    quality: locationQualityEnum('quality').notNull(),
    isStale: boolean('is_stale').notNull().default(false),
  },
  (t) => [
    unique('vehicle_current_location_pk').on(t.tenantId, t.vehicleId),
    foreignKey({
      name: 'vehicle_current_location_vehicle_fk',
      columns: [t.tenantId, t.vehicleId],
      foreignColumns: [vehicle.tenantId, vehicle.id],
    }),
    foreignKey({
      name: 'vehicle_current_location_trip_fk',
      columns: [t.tenantId, t.tripId],
      foreignColumns: [trip.tenantId, trip.id],
    }),
    foreignKey({
      name: 'vehicle_current_location_device_fk',
      columns: [t.tenantId, t.sourceDeviceId],
      foreignColumns: [device.tenantId, device.id],
    }),
    check('vehicle_current_location_lat', sql`${t.lat} between -90 and 90`),
    check('vehicle_current_location_lng', sql`${t.lng} between -180 and 180`),
    tenantIsolation('vehicle_current_location'),
  ],
).enableRLS();

/** Aylık partition + 14 gün saklama SQL tarafında. */
export const vehicleLocationPing = pgTable(
  'vehicle_location_ping',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    vehicleId: uuid('vehicle_id').notNull(),
    tripId: uuid('trip_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    speed: real('speed'),
    heading: real('heading'),
    accuracyM: real('accuracy_m'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    sourceDeviceId: uuid('source_device_id').notNull(),
    sessionEpoch: integer('session_epoch').notNull(),
    quality: locationQualityEnum('quality').notNull(),
  },
  (t) => [
    unique('vehicle_location_ping_pk').on(t.id, t.recordedAt),
    foreignKey({
      name: 'vehicle_location_ping_trip_fk',
      columns: [t.tenantId, t.tripId],
      foreignColumns: [trip.tenantId, trip.id],
    }),
    foreignKey({
      name: 'vehicle_location_ping_vehicle_fk',
      columns: [t.tenantId, t.vehicleId],
      foreignColumns: [vehicle.tenantId, vehicle.id],
    }),
    check('vehicle_location_ping_lat', sql`${t.lat} between -90 and 90`),
    check('vehicle_location_ping_lng', sql`${t.lng} between -180 and 180`),
    tenantIsolation('vehicle_location_ping'),
  ],
).enableRLS();
