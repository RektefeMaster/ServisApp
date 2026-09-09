import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

export interface World {
  tenantA: string;
  tenantB: string;
  tripId: string;
  tripStudentId: string;
  studentId: string;
  stopId: string;
  addressId: string;
  routeId: string;
  membershipId: string;
  otherStudentId: string;
  vehicleId: string;
  deviceId: string;
}

const ts = '2026-09-09T04:40:00+03:00';
let phoneSeq = 0;

function uniquePhone(): string {
  phoneSeq += 1;
  return `+905${String(1_000_000_000 + phoneSeq).slice(-9)}`;
}

export async function insertWorld(sql: postgres.Sql): Promise<World> {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const identityA = randomUUID();
  const identityB = randomUUID();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  const addressA = randomUUID();
  const addressB = randomUUID();
  const stopA = randomUUID();
  const schoolA = randomUUID();
  const schoolB = randomUUID();
  const vehicleA = randomUUID();
  const vehicleB = randomUUID();
  const studentA = randomUUID();
  const studentB = randomUUID();
  const routeA = randomUUID();
  const routeVersionA = randomUUID();
  const tripA = randomUUID();
  const tripStopA = randomUUID();
  const tripStudentA = randomUUID();
  const deviceA = randomUUID();

  await sql`
    insert into tenant (id, name) values
      (${tenantA}, 'Tenant A'),
      (${tenantB}, 'Tenant B')
  `;
  await sql`
    insert into identity (id, auth_user_id, phone_e164, full_name) values
      (${identityA}, ${randomUUID()}, ${uniquePhone()}, 'Ayşe Yılmaz'),
      (${identityB}, ${randomUUID()}, ${uniquePhone()}, 'Mehmet Demir')
  `;
  await sql`
    insert into tenant_membership (id, tenant_id, identity_id, status) values
      (${membershipA}, ${tenantA}, ${identityA}, 'ACTIVE'),
      (${membershipB}, ${tenantB}, ${identityB}, 'ACTIVE')
  `;
  await sql`
    insert into device (id, tenant_id, membership_id, platform) values
      (${deviceA}, ${tenantA}, ${membershipA}, 'IOS')
  `;
  await sql`
    insert into address (id, tenant_id, "text", il, ilce, lat, lng) values
      (${addressA}, ${tenantA}, 'Atatürk Cad. 1', 'İstanbul', 'Kadıköy', 40.99, 29.03),
      (${addressB}, ${tenantB}, 'Başka mahalle 1', 'Ankara', 'Çankaya', 39.9, 32.85)
  `;
  await sql`
    insert into stop (id, tenant_id, address_id, lat, lng, label) values
      (${stopA}, ${tenantA}, ${addressA}, 40.9901, 29.0301, 'Durak 1')
  `;
  await sql`
    insert into school (id, tenant_id, name, level, address_id, attendant_required) values
      (${schoolA}, ${tenantA}, 'Güneş İlkokulu', 'PRIMARY', ${addressA}, true),
      (${schoolB}, ${tenantB}, 'Başka Okul', 'PRIMARY', ${addressB}, true)
  `;
  await sql`
    insert into vehicle (id, tenant_id, plate, seat_count) values
      (${vehicleA}, ${tenantA}, '34ABC123', 16),
      (${vehicleB}, ${tenantB}, '06XYZ999', 16)
  `;
  await sql`
    insert into student (id, tenant_id, school_id, full_name, handover_policy, enrollment_start) values
      (${studentA}, ${tenantA}, ${schoolA}, 'Elif Yılmaz', 'GUARDIAN_REQUIRED', '2026-09-01'),
      (${studentB}, ${tenantB}, ${schoolB}, 'Can Demir', 'GUARDIAN_REQUIRED', '2026-09-01')
  `;
  await sql`
    insert into route (id, tenant_id, vehicle_id, school_id, segment, shift_no) values
      (${routeA}, ${tenantA}, ${vehicleA}, ${schoolA}, 'MORNING', 1)
  `;
  await sql`
    insert into route_version (id, tenant_id, route_id, version_no, status, effective_from) values
      (${routeVersionA}, ${tenantA}, ${routeA}, 1, 'PUBLISHED', '2026-09-01')
  `;
  await sql`
    insert into trip (
      id, tenant_id, route_id, route_version_id, service_date, segment, state,
      planned_departure_at, current_vehicle_id, current_driver_membership_id
    ) values (
      ${tripA}, ${tenantA}, ${routeA}, ${routeVersionA}, '2026-09-09', 'MORNING', 'ACTIVE',
      ${ts}, ${vehicleA}, ${membershipA}
    )
  `;
  await sql`
    insert into trip_stop (
      id, tenant_id, trip_id, seq, kind, source_stop_id,
      snapshot_lat, snapshot_lng, snapshot_label, snapshot_address_text
    ) values (
      ${tripStopA}, ${tenantA}, ${tripA}, 1, 'PICKUP', ${stopA},
      40.9901, 29.0301, 'Durak 1', 'Atatürk Cad. 1'
    )
  `;
  await sql`
    insert into trip_student (
      id, tenant_id, trip_id, student_id, state, delivery_target, expected_stop_id,
      snapshot_dropoff_lat, snapshot_dropoff_lng, snapshot_dropoff_text
    ) values (
      ${tripStudentA}, ${tenantA}, ${tripA}, ${studentA}, 'EXPECTED', 'HOME', ${tripStopA},
      40.9901, 29.0301, 'Atatürk Cad. 1'
    )
  `;

  return {
    tenantA,
    tenantB,
    tripId: tripA,
    tripStudentId: tripStudentA,
    studentId: studentA,
    stopId: stopA,
    addressId: addressA,
    routeId: routeA,
    membershipId: membershipA,
    otherStudentId: studentB,
    vehicleId: vehicleA,
    deviceId: deviceA,
  };
}

export async function asApi<T>(
  sql: postgres.Sql,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  let result!: T;
  await sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`select set_config('app.membership_id', '', true)`;
    await tx`select set_config('app.role', 'ADMIN', true)`;
    await tx.unsafe('set local role servisapp_api');
    result = await fn(tx);
  });
  return result;
}
