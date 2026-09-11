/**
 * Yerel geliştirme tohumu. Üretimde kullanılmaz.
 *   pnpm db:seed
 */
import postgres from 'postgres';

const url = process.env['MIGRATION_DATABASE_URL'];
if (!url) throw new Error('MIGRATION_DATABASE_URL tanımlı değil');

const TENANT = '00000000-0000-4000-8000-000000000001';

const sql = postgres(url, { max: 1 });

try {
  const [existing] = await sql<{ id: string }[]>`select id from tenant where id = ${TENANT}`;
  if (existing) {
    console.log('✓ tohum zaten var');
  } else {
    await sql.begin(async (tx) => {
      const identity = '00000000-0000-4000-8000-000000000010';
      const membership = '00000000-0000-4000-8000-000000000011';
      const adminIdentity = '00000000-0000-4000-8000-000000000012';
      const adminMembership = '00000000-0000-4000-8000-000000000013';
      const address = '00000000-0000-4000-8000-000000000020';
      const stop = '00000000-0000-4000-8000-000000000021';
      const school = '00000000-0000-4000-8000-000000000030';
      const vehicle = '00000000-0000-4000-8000-000000000040';
      const student = '00000000-0000-4000-8000-000000000050';
      const route = '00000000-0000-4000-8000-000000000060';
      const routeVersion = '00000000-0000-4000-8000-000000000061';

      await tx`insert into tenant (id, name) values (${TENANT}, 'Demo Servis')`;
      await tx`
        insert into identity (id, auth_user_id, phone_e164, email, full_name)
        values (${identity}, ${identity}, '+905321000001', 'sofor@demo.local', 'Demo Şoför')
      `;
      await tx`
        insert into tenant_membership (id, tenant_id, identity_id, status)
        values (${membership}, ${TENANT}, ${identity}, 'ACTIVE')
      `;
      await tx`
        insert into membership_role (tenant_id, membership_id, role)
        values (${TENANT}, ${membership}, 'DRIVER')
      `;
      await tx`
        insert into identity (id, auth_user_id, phone_e164, email, full_name)
        values (${adminIdentity}, ${adminIdentity}, '+905321000002', 'admin@demo.local', 'Demo Yönetici')
      `;
      await tx`
        insert into tenant_membership (id, tenant_id, identity_id, status)
        values (${adminMembership}, ${TENANT}, ${adminIdentity}, 'ACTIVE')
      `;
      await tx`
        insert into membership_role (tenant_id, membership_id, role)
        values (${TENANT}, ${adminMembership}, 'ADMIN')
      `;
      await tx`
        insert into address (id, tenant_id, "text", il, ilce, lat, lng)
        values (${address}, ${TENANT}, 'Okul Caddesi 1', 'İstanbul', 'Kadıköy', 40.99, 29.03)
      `;
      await tx`
        insert into stop (id, tenant_id, address_id, lat, lng, label)
        values (${stop}, ${TENANT}, ${address}, 40.9901, 29.0301, 'Okul duragi')
      `;
      await tx`
        insert into school (id, tenant_id, name, level, address_id)
        values (${school}, ${TENANT}, 'Demo İlkokul', 'PRIMARY', ${address})
      `;
      await tx`
        insert into vehicle (id, tenant_id, plate, seat_count)
        values (${vehicle}, ${TENANT}, '34DEMO01', 16)
      `;
      await tx`
        insert into student (id, tenant_id, school_id, full_name, handover_policy, enrollment_start)
        values (${student}, ${TENANT}, ${school}, 'Demo Öğrenci', 'GUARDIAN_REQUIRED', '2026-09-01')
      `;
      await tx`
        insert into route (id, tenant_id, vehicle_id, school_id, segment, shift_no)
        values (${route}, ${TENANT}, ${vehicle}, ${school}, 'MORNING', 1)
      `;
      await tx`
        insert into route_version (id, tenant_id, route_id, version_no, status, effective_from)
        values (${routeVersion}, ${TENANT}, ${route}, 1, 'PUBLISHED', '2026-09-01')
      `;
      await tx`
        insert into route_stop (tenant_id, route_version_id, stop_id, seq, kind)
        values (${TENANT}, ${routeVersion}, ${stop}, 1, 'SCHOOL')
      `;
    });
    console.log('✓ tohum yazıldı');
  }
} finally {
  await sql.end();
}
