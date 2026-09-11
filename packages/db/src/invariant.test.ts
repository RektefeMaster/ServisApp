import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, migrationsDir } from './migrate-files.js';
import { asApi, insertWorld } from './test/fixture.js';
import { startHarness, stopHarness, type Harness } from './test/harness.js';

async function withOtpOk<T>(
  sql: postgres.Sql,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return asApi(sql, tenantId, async (tx) => {
    await tx`select set_config('app.delivery_otp_ok', 'on', true)`;
    return fn(tx);
  });
}

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 120_000);

afterAll(async () => {
  if (harness) await stopHarness(harness);
});

describe('sefer kapanışı', () => {
  it('üstünde ON_BOARD öğrenci varken COMPLETED yazılamaz', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      update trip_student set state = 'ON_BOARD', state_seq = 1
      where id = ${world.tripStudentId}
    `;
    await harness.sql`
      insert into trip_vehicle_check (tenant_id, trip_id, phase, checked_by, vehicle_empty_confirmed)
      values (${world.tenantA}, ${world.tripId}, 'AFTER', ${world.membershipId}, true)
    `;

    await expect(
      asApi(harness.sql, world.tenantA, (tx) => tx`select complete_trip(${world.tripId}::uuid)`),
    ).rejects.toThrow(/students_still_on_trip/);
  });

  it('araç içi kontrol yoksa sefer kapanamaz', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      update trip_student set state = 'DELIVERED', state_seq = 1
      where id = ${world.tripStudentId}
    `;

    await expect(
      asApi(harness.sql, world.tenantA, (tx) => tx`select complete_trip(${world.tripId}::uuid)`),
    ).rejects.toThrow(/vehicle_sweep_not_confirmed/);
  });

  it('öğrenciler çözülmüş ve araç boşsa sefer kapanır', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      update trip_student set state = 'DELIVERED', state_seq = 1
      where id = ${world.tripStudentId}
    `;
    await harness.sql`
      insert into trip_vehicle_check (tenant_id, trip_id, phase, checked_by, vehicle_empty_confirmed)
      values (${world.tenantA}, ${world.tripId}, 'AFTER', ${world.membershipId}, true)
    `;

    await asApi(
      harness.sql,
      world.tenantA,
      (tx) => tx`select complete_trip(${world.tripId}::uuid)`,
    );
    const [row] = await harness.sql<{ state: string }[]>`
      select state from trip where id = ${world.tripId}
    `;
    expect(row?.state).toBe('COMPLETED');
  });

  it('READY sefer COMPLETED olamaz', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      update trip_student set state = 'DELIVERED', state_seq = 1
      where id = ${world.tripStudentId}
    `;
    await harness.sql`
      insert into trip_vehicle_check (tenant_id, trip_id, phase, checked_by, vehicle_empty_confirmed)
      values (${world.tenantA}, ${world.tripId}, 'AFTER', ${world.membershipId}, true)
    `;
    await harness.sql`update trip set state = 'READY' where id = ${world.tripId}`;

    await expect(
      asApi(harness.sql, world.tenantA, (tx) => tx`select complete_trip(${world.tripId}::uuid)`),
    ).rejects.toThrow(/trip_not_active/);

    await expect(
      harness.sql`update trip set state = 'COMPLETED' where id = ${world.tripId}`,
    ).rejects.toThrow(/trip_not_active/);
  });

  it('AUTO_CLOSED araçtaki çocukla yazılamaz', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      update trip_student set state = 'ON_BOARD', state_seq = 1
      where id = ${world.tripStudentId}
    `;
    await expect(
      harness.sql`update trip set state = 'AUTO_CLOSED' where id = ${world.tripId}`,
    ).rejects.toThrow(/students_still_on_trip/);
  });

  it('ABORTED çözülmemiş öğrenciyle yazılamaz', async () => {
    const world = await insertWorld(harness.sql);
    await expect(
      harness.sql`update trip set state = 'ABORTED' where id = ${world.tripId}`,
    ).rejects.toThrow(/students_still_on_trip/);
  });
});

describe('TEMP teslimat', () => {
  it('doğrulanmamış TEMP teslimat DELIVERED olamaz', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      update trip_student
      set state = 'ON_BOARD', delivery_target = 'TEMP', state_seq = 1
      where id = ${world.tripStudentId}
    `;

    await expect(
      harness.sql`
        update trip_student set state = 'DELIVERED'
        where id = ${world.tripStudentId}
      `,
    ).rejects.toThrow(/temp_delivery_requires_verification/);
  });

  it('mark_delivery_verified OTP ile doğrular, ciphertext silinir', async () => {
    const world = await insertWorld(harness.sql);
    const overrideId = randomUUID();
    await harness.sql`
      insert into delivery_override (
        id, tenant_id, student_id, service_date, address_id,
        receiver_name, receiver_phone, otp_hmac, otp_ciphertext, status
      ) values (
        ${overrideId}, ${world.tenantA}, ${world.studentId}, '2026-09-09', ${world.addressId},
        'Teyze', '+905321119999', '\\x00'::bytea, '\\x01'::bytea, 'ACTIVE'
      )
    `;
    await harness.sql`
      update trip_student
      set state = 'ON_BOARD', delivery_target = 'TEMP', state_seq = 1
      where id = ${world.tripStudentId}
    `;

    await withOtpOk(
      harness.sql,
      world.tenantA,
      (tx) => tx`select mark_delivery_verified(${overrideId}::uuid, ${world.tripStudentId}::uuid)`,
    );

    const [student] = await harness.sql<
      {
        delivery_method: string;
        delivery_verified_at: Date | null;
      }[]
    >`
      select delivery_method, delivery_verified_at from trip_student where id = ${world.tripStudentId}
    `;
    expect(student?.delivery_method).toBe('OTP');
    expect(student?.delivery_verified_at).toBeTruthy();

    const [override] = await harness.sql<{ status: string; otp_ciphertext: Buffer | null }[]>`
      select status, otp_ciphertext from delivery_override where id = ${overrideId}
    `;
    expect(override?.status).toBe('VERIFIED');
    expect(override?.otp_ciphertext).toBeNull();

    await harness.sql`
      update trip_student set state = 'DELIVERED' where id = ${world.tripStudentId}
    `;
  });

  it('doğrulanmamış TEMP teslimat DELIVERED_LATE olamaz', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      update trip_student
      set state = 'ON_BOARD', delivery_target = 'TEMP', state_seq = 1
      where id = ${world.tripStudentId}
    `;

    await expect(
      harness.sql`
        update trip_student set state = 'DELIVERED_LATE'
        where id = ${world.tripStudentId}
      `,
    ).rejects.toThrow(/temp_delivery_requires_verification/);
  });

  it('doğrulanmamış TEMP teslimat RETURNED_HOME olamaz', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      update trip_student
      set state = 'ON_BOARD', delivery_target = 'TEMP', state_seq = 1
      where id = ${world.tripStudentId}
    `;

    await expect(
      harness.sql`
        update trip_student set state = 'RETURNED_HOME'
        where id = ${world.tripStudentId}
      `,
    ).rejects.toThrow(/temp_delivery_requires_verification/);
  });

  it('süresi bitmiş OTP ile doğrulama reddedilir', async () => {
    const world = await insertWorld(harness.sql);
    const overrideId = randomUUID();
    await harness.sql`
      insert into delivery_override (
        id, tenant_id, student_id, service_date, address_id,
        receiver_name, receiver_phone, otp_hmac, otp_ciphertext, otp_expires_at, status
      ) values (
        ${overrideId}, ${world.tenantA}, ${world.studentId}, '2026-09-09', ${world.addressId},
        'Teyze', '+905321119999', '\\x00'::bytea, '\\x01'::bytea,
        now() - interval '1 minute', 'ACTIVE'
      )
    `;
    await harness.sql`
      update trip_student
      set state = 'ON_BOARD', delivery_target = 'TEMP', state_seq = 1
      where id = ${world.tripStudentId}
    `;

    await expect(
      withOtpOk(
        harness.sql,
        world.tenantA,
        (tx) =>
          tx`select mark_delivery_verified(${overrideId}::uuid, ${world.tripStudentId}::uuid)`,
      ),
    ).rejects.toThrow(/delivery_override_expired/);
  });

  it('kilitli OTP ile doğrulama reddedilir', async () => {
    const world = await insertWorld(harness.sql);
    const overrideId = randomUUID();
    await harness.sql`
      insert into delivery_override (
        id, tenant_id, student_id, service_date, address_id,
        receiver_name, receiver_phone, otp_hmac, otp_ciphertext, locked_until, status
      ) values (
        ${overrideId}, ${world.tenantA}, ${world.studentId}, '2026-09-09', ${world.addressId},
        'Teyze', '+905321119998', '\\x00'::bytea, '\\x01'::bytea,
        now() + interval '10 minutes', 'ACTIVE'
      )
    `;
    await harness.sql`
      update trip_student
      set state = 'ON_BOARD', delivery_target = 'TEMP', state_seq = 1
      where id = ${world.tripStudentId}
    `;

    await expect(
      withOtpOk(
        harness.sql,
        world.tenantA,
        (tx) =>
          tx`select mark_delivery_verified(${overrideId}::uuid, ${world.tripStudentId}::uuid)`,
      ),
    ).rejects.toThrow(/delivery_override_locked/);
  });
});

describe('olay kaydı ve yetki', () => {
  it('servisapp_api event satırını güncelleyemez', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      insert into event (tenant_id, subject_type, subject_id, event_type)
      values (${world.tenantA}, 'TRIP', ${world.tripId}, 'TRIP_STARTED')
    `;
    await expect(
      asApi(harness.sql, world.tenantA, (tx) => tx`update event set event_type = 'HACK'`),
    ).rejects.toThrow(/permission denied|event_is_append_only/);
  });

  it('servisapp_api trip_student üzerinde doğrudan UPDATE yapamaz', async () => {
    const world = await insertWorld(harness.sql);
    await expect(
      asApi(
        harness.sql,
        world.tenantA,
        (tx) => tx`update trip_student set state = 'ON_BOARD' where id = ${world.tripStudentId}`,
      ),
    ).rejects.toThrow();
  });
});

describe('kiracı izolasyonu', () => {
  it('bileşik FK başka tenant öğrencisini sefere bağlayamaz', async () => {
    const world = await insertWorld(harness.sql);
    await expect(
      harness.sql`
        insert into trip_student (
          tenant_id, trip_id, student_id, delivery_target
        ) values (
          ${world.tenantA}, ${world.tripId}, ${world.otherStudentId}, 'HOME'
        )
      `,
    ).rejects.toThrow();
  });

  it('tenant bağlamı yokken sorgu başarısız olur', async () => {
    await insertWorld(harness.sql);
    await expect(
      harness.sql.begin(async (tx) => {
        await tx.unsafe('set local role servisapp_api');
        await tx`select id from trip`;
      }),
    ).rejects.toThrow(/app\.tenant_id is not set/);
  });

  it('yanlış tenant satırı görmez', async () => {
    const world = await insertWorld(harness.sql);
    const rows = await asApi(
      harness.sql,
      world.tenantB,
      (tx) => tx<{ id: string }[]>`select id from trip where id = ${world.tripId}`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('CAS', () => {
  it('aynı state_seq için iki eşzamanlı güncellemeden yalnız biri kazanır', async () => {
    const world = await insertWorld(harness.sql);
    const sql1 = postgres(harness.url, { max: 1, prepare: false, onnotice: () => {} });
    const sql2 = postgres(harness.url, { max: 1, prepare: false, onnotice: () => {} });
    const counts: number[] = [];
    try {
      await Promise.all([
        sql1.begin(async (tx) => {
          await tx`select id from trip_student where id = ${world.tripStudentId} for update`;
          await tx`select pg_sleep(0.3)`;
          const result = await tx`
            update trip_student
            set state = 'ON_BOARD', state_seq = 1, state_changed_at = now()
            where id = ${world.tripStudentId} and state_seq = 0
          `;
          counts.push(result.count);
        }),
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          await sql2.begin(async (tx) => {
            await tx`select id from trip_student where id = ${world.tripStudentId} for update`;
            const result = await tx`
              update trip_student
              set state = 'NO_SHOW', state_seq = 1, state_changed_at = now()
              where id = ${world.tripStudentId} and state_seq = 0
            `;
            counts.push(result.count);
          });
        })(),
      ]);
    } finally {
      await sql1.end();
      await sql2.end();
    }
    expect(new Set(counts)).toEqual(new Set([0, 1]));
  });
});

describe('rota snapshot', () => {
  it('kalıcı durak/adres değişince sefer kopyası aynı kalır ve sefer yine tamamlanır', async () => {
    const world = await insertWorld(harness.sql);
    const [before] = await harness.sql<{ snapshot_lat: number; snapshot_lng: number }[]>`
      select snapshot_lat, snapshot_lng from trip_stop where trip_id = ${world.tripId}
    `;

    const newAddressId = randomUUID();
    await harness.sql`
      insert into address (id, tenant_id, "text", il, ilce, lat, lng) values
        (${newAddressId}, ${world.tenantA}, 'değişti', 'İstanbul', 'Kadıköy', 1, 1)
    `;
    await expect(
      harness.sql`update address set lat = 1, lng = 1, "text" = 'değişti' where id = ${world.addressId}`,
    ).rejects.toThrow(/address_is_append_only/);

    await harness.sql`
      update stop
      set address_id = ${newAddressId}, lat = 2, lng = 2, label = 'yeni'
      where id = ${world.stopId}
    `;
    await harness.sql`update route set max_detour_m = 9 where id = ${world.routeId}`;

    const [after] = await harness.sql<{ snapshot_lat: number; snapshot_lng: number }[]>`
      select snapshot_lat, snapshot_lng from trip_stop where trip_id = ${world.tripId}
    `;
    expect(after).toEqual(before);

    await harness.sql`
      update trip_student set state = 'ABSENT_PLANNED', state_seq = 1
      where id = ${world.tripStudentId}
    `;
    await harness.sql`
      insert into trip_vehicle_check (tenant_id, trip_id, phase, checked_by, vehicle_empty_confirmed)
      values (${world.tenantA}, ${world.tripId}, 'AFTER', ${world.membershipId}, true)
    `;
    await asApi(
      harness.sql,
      world.tenantA,
      (tx) => tx`select complete_trip(${world.tripId}::uuid)`,
    );
  });
});

describe('şema emniyeti', () => {
  it('uygulama rolleri BYPASSRLS taşımaz ve fonksiyonlar definer sahibindedir', async () => {
    const roles = await harness.sql<{ rolname: string; rolbypassrls: boolean }[]>`
      select rolname, rolbypassrls
      from pg_roles
      where rolname in ('servisapp_api', 'servisapp_worker', 'servisapp_definer')
      order by rolname
    `;
    expect(roles).toHaveLength(3);
    expect(roles.every((row) => row.rolbypassrls === false)).toBe(true);

    const owners = await harness.sql<{ proname: string; rolname: string }[]>`
      select p.proname, r.rolname
      from pg_proc p
      join pg_roles r on r.oid = p.proowner
      where p.proname in (
        'complete_trip', 'mark_delivery_verified', 'admin_override_delivery',
        'ensure_identity', 'resolve_session', 'list_tenants_for_jobs',
        'lock_trip_student_for_command', 'apply_student_state_transition',
        'apply_trip_student_plan',
        'find_dev_login_identity', 'find_dev_parent_identity', 'invalidate_after_check_when_occupied',
        'find_identity_by_phone', 'find_invite_by_token_hash', 'update_trip_student_tracking'
      )
      order by p.proname
    `;
    expect(owners).toEqual([
      { proname: 'admin_override_delivery', rolname: 'servisapp_definer' },
      { proname: 'apply_student_state_transition', rolname: 'servisapp_definer' },
      { proname: 'apply_trip_student_plan', rolname: 'servisapp_definer' },
      { proname: 'complete_trip', rolname: 'servisapp_definer' },
      { proname: 'ensure_identity', rolname: 'servisapp_definer' },
      { proname: 'find_dev_login_identity', rolname: 'servisapp_definer' },
      { proname: 'find_dev_parent_identity', rolname: 'servisapp_definer' },
      { proname: 'find_identity_by_phone', rolname: 'servisapp_definer' },
      { proname: 'find_invite_by_token_hash', rolname: 'servisapp_definer' },
      { proname: 'invalidate_after_check_when_occupied', rolname: 'servisapp_definer' },
      { proname: 'list_tenants_for_jobs', rolname: 'servisapp_definer' },
      { proname: 'lock_trip_student_for_command', rolname: 'servisapp_definer' },
      { proname: 'mark_delivery_verified', rolname: 'servisapp_definer' },
      { proname: 'resolve_session', rolname: 'servisapp_definer' },
      { proname: 'update_trip_student_tracking', rolname: 'servisapp_definer' },
    ]);
  });

  it('worker teslim ve oturum fonksiyonlarını yürütemez', async () => {
    const grants = await harness.sql<{ fn: string; worker: boolean; api: boolean }[]>`
      select * from (values
        ('mark_delivery_verified(uuid,uuid)',
          has_function_privilege('servisapp_worker', 'mark_delivery_verified(uuid,uuid)', 'execute'),
          has_function_privilege('servisapp_api', 'mark_delivery_verified(uuid,uuid)', 'execute')),
        ('admin_override_delivery(uuid,uuid,text)',
          has_function_privilege('servisapp_worker', 'admin_override_delivery(uuid,uuid,text)', 'execute'),
          has_function_privilege('servisapp_api', 'admin_override_delivery(uuid,uuid,text)', 'execute')),
        ('resolve_session(uuid,text,text)',
          has_function_privilege('servisapp_worker', 'resolve_session(uuid,text,text)', 'execute'),
          has_function_privilege('servisapp_api', 'resolve_session(uuid,text,text)', 'execute')),
        ('identity_has_other_tenants(uuid,uuid)',
          has_function_privilege('servisapp_worker', 'identity_has_other_tenants(uuid,uuid)', 'execute'),
          has_function_privilege('servisapp_api', 'identity_has_other_tenants(uuid,uuid)', 'execute')),
        ('apply_trip_student_plan(uuid,boolean,student_state,boolean,delivery_target,boolean,boolean,boolean,text,boolean,double precision,double precision,text)',
          has_function_privilege('servisapp_worker', 'apply_trip_student_plan(uuid,boolean,student_state,boolean,delivery_target,boolean,boolean,boolean,text,boolean,double precision,double precision,text)', 'execute'),
          has_function_privilege('servisapp_api', 'apply_trip_student_plan(uuid,boolean,student_state,boolean,delivery_target,boolean,boolean,boolean,text,boolean,double precision,double precision,text)', 'execute'))
      ) as g(fn, worker, api)
    `;
    expect(grants.every((row) => row.api === true && row.worker === false)).toBe(true);
  });

  it('migration ikinci kez çalışınca no-op olur', async () => {
    await applyMigrations(harness.url);
    await applyMigrations(harness.url);
    const [row] = await harness.sql<{ n: number }[]>`
      select count(*)::int as n from schema_migrations
    `;
    const files = (await readdir(migrationsDir())).filter((name) => name.endsWith('.sql'));
    expect(row?.n).toBe(files.length);
  });

  it('auth_user_id olmadan kimlik açılır ve SYSTEM olay aktörü yazılır', async () => {
    const world = await insertWorld(harness.sql);
    const phone = `+9055${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
    await harness.sql`
      insert into identity (phone_e164, full_name)
      values (${phone}, 'Davetli Veli')
    `;
    await harness.sql`
      insert into event (
        tenant_id, subject_type, subject_id, event_type, actor_role
      ) values (
        ${world.tenantA}, 'TRIP', ${world.tripId}, 'SYSTEM_TICK', 'SYSTEM'
      )
    `;
  });

  it('servisapp_api olay ekleyebilir, partition üzerinden başka tenant görmez', async () => {
    const world = await insertWorld(harness.sql);
    await asApi(
      harness.sql,
      world.tenantA,
      (tx) => tx`
        insert into event (tenant_id, subject_type, subject_id, event_type, actor_role)
        values (${world.tenantA}, 'TRIP', ${world.tripId}, 'TRIP_STARTED', 'SYSTEM')
      `,
    );
    const visible = await asApi(
      harness.sql,
      world.tenantA,
      (tx) => tx<{ n: number }[]>`select count(*)::int as n from event`,
    );
    expect((visible[0]?.n ?? 0) >= 1).toBe(true);

    const hidden = await asApi(
      harness.sql,
      world.tenantB,
      (tx) =>
        tx<{ n: number }[]>`
          select count(*)::int as n from event where tenant_id = ${world.tenantA}
        `,
    );
    expect(hidden[0]?.n).toBe(0);

    await asApi(
      harness.sql,
      world.tenantA,
      (tx) => tx`
        insert into vehicle_location_ping (
          tenant_id, vehicle_id, trip_id, lat, lng, recorded_at,
          source_device_id, session_epoch, quality
        ) values (
          ${world.tenantA}, ${world.vehicleId}, ${world.tripId},
          40.99, 29.03, now(), ${world.deviceId}, 0, 'GOOD'
        )
      `,
    );
  });

  it('platform ayarı tenant GUC olmadan okunur', async () => {
    const rows = await harness.sql.begin(async (tx) => {
      await tx.unsafe('set local role servisapp_api');
      return tx<{ min_supported_app_version: string }[]>`
        select min_supported_app_version from platform_settings
      `;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.min_supported_app_version).toBe('0.0.0');
  });

  it('resolve_session veli telefonuyla bağlanmaz, GUARDIAN INVITED kalır', async () => {
    const world = await insertWorld(harness.sql);
    const authUserId = randomUUID();
    const phone = `+9055${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
    const [person] = await harness.sql<{ id: string }[]>`
      insert into identity (phone_e164, full_name)
      values (${phone}, 'Davetli Veli')
      returning id
    `;
    if (!person) throw new Error('identity insert failed');
    const [membership] = await harness.sql<{ id: string }[]>`
      insert into tenant_membership (tenant_id, identity_id, status)
      values (${world.tenantA}, ${person.id}::uuid, 'INVITED')
      returning id
    `;
    if (!membership) throw new Error('membership insert failed');
    await harness.sql`
      insert into membership_role (tenant_id, membership_id, role)
      values (${world.tenantA}, ${membership.id}::uuid, 'GUARDIAN')
    `;

    await expect(
      harness.sql.begin(async (tx) => {
        await tx.unsafe('set local role servisapp_api');
        return tx`select resolve_session(${authUserId}::uuid, ${phone}, null) as session`;
      }),
    ).rejects.toThrow(/identity_not_provisioned/);

    const [unbound] = await harness.sql<{ auth_user_id: string | null }[]>`
      select auth_user_id::text from identity where id = ${person.id}::uuid
    `;
    expect(unbound?.auth_user_id).toBeNull();
  });

  it('resolve_session personel davetini ilk girişte etkinleştirir', async () => {
    const world = await insertWorld(harness.sql);
    const authUserId = randomUUID();
    const phone = `+9055${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
    const [person] = await harness.sql<{ id: string }[]>`
      insert into identity (phone_e164, full_name)
      values (${phone}, 'Davetli Şoför')
      returning id
    `;
    if (!person) throw new Error('identity insert failed');
    const [membership] = await harness.sql<{ id: string }[]>`
      insert into tenant_membership (tenant_id, identity_id, status)
      values (${world.tenantA}, ${person.id}::uuid, 'INVITED')
      returning id
    `;
    if (!membership) throw new Error('membership insert failed');
    await harness.sql`
      insert into membership_role (tenant_id, membership_id, role)
      values (${world.tenantA}, ${membership.id}::uuid, 'DRIVER')
    `;

    const sessionRows = await harness.sql.begin(async (tx) => {
      await tx.unsafe('set local role servisapp_api');
      return tx<
        { session: { identityId: string; memberships: { status: string; roles: string[] }[] } }[]
      >`
        select resolve_session(${authUserId}::uuid, ${phone}, null) as session
      `;
    });
    const session = sessionRows[0]?.session;
    expect(session?.identityId).toBe(person.id);
    expect(session?.memberships[0]?.status).toBe('ACTIVE');
    expect(session?.memberships[0]?.roles).toContain('DRIVER');
  });

  it('resolve_session GUARDIAN davetini personel rolüyle atlatmaz', async () => {
    const world = await insertWorld(harness.sql);
    const authUserId = randomUUID();
    const phone = `+9055${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
    const [person] = await harness.sql<{ id: string }[]>`
      insert into identity (phone_e164, full_name)
      values (${phone}, 'Veli Şoför')
      returning id
    `;
    if (!person) throw new Error('identity insert failed');
    const [membership] = await harness.sql<{ id: string }[]>`
      insert into tenant_membership (tenant_id, identity_id, status)
      values (${world.tenantA}, ${person.id}::uuid, 'INVITED')
      returning id
    `;
    if (!membership) throw new Error('membership insert failed');
    await harness.sql`
      insert into membership_role (tenant_id, membership_id, role)
      values
        (${world.tenantA}, ${membership.id}::uuid, 'GUARDIAN'),
        (${world.tenantA}, ${membership.id}::uuid, 'DRIVER')
    `;

    const sessionRows = await harness.sql.begin(async (tx) => {
      await tx.unsafe('set local role servisapp_api');
      return tx<
        { session: { identityId: string; memberships: { status: string; roles: string[] }[] } }[]
      >`
        select resolve_session(${authUserId}::uuid, ${phone}, null) as session
      `;
    });
    const session = sessionRows[0]?.session;
    expect(session?.identityId).toBe(person.id);
    expect(session?.memberships[0]?.status).toBe('INVITED');
    expect(session?.memberships[0]?.roles).toEqual(expect.arrayContaining(['DRIVER', 'GUARDIAN']));

    const [status] = await harness.sql<{ status: string }[]>`
      select status::text from tenant_membership where id = ${membership.id}::uuid
    `;
    expect(status?.status).toBe('INVITED');
  });

  it('resolve_session e-posta ile bağlanmamış kimliği gasp etmez', async () => {
    const world = await insertWorld(harness.sql);
    const authUserId = randomUUID();
    const phone = `+9055${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
    const email = `sofor-${randomUUID().slice(0, 8)}@ornek.test`;
    const [person] = await harness.sql<{ id: string }[]>`
      insert into identity (phone_e164, email, full_name)
      values (${phone}, ${email}, 'Davetli Şoför')
      returning id
    `;
    if (!person) throw new Error('identity insert failed');
    const [membership] = await harness.sql<{ id: string }[]>`
      insert into tenant_membership (tenant_id, identity_id, status)
      values (${world.tenantA}, ${person.id}::uuid, 'INVITED')
      returning id
    `;
    if (!membership) throw new Error('membership insert failed');
    await harness.sql`
      insert into membership_role (tenant_id, membership_id, role)
      values (${world.tenantA}, ${membership.id}::uuid, 'DRIVER')
    `;

    await expect(
      harness.sql.begin(async (tx) => {
        await tx.unsafe('set local role servisapp_api');
        return tx`select resolve_session(${authUserId}::uuid, null, ${email}) as session`;
      }),
    ).rejects.toThrow(/identity_not_provisioned/);

    const [unbound] = await harness.sql<{ auth_user_id: string | null }[]>`
      select auth_user_id::text from identity where id = ${person.id}::uuid
    `;
    expect(unbound?.auth_user_id).toBeNull();
  });

  it('servisapp_api teslimat kolonuna GUC ile de yazamaz', async () => {
    const world = await insertWorld(harness.sql);
    await expect(
      asApi(harness.sql, world.tenantA, async (tx) => {
        await tx`select set_config('app.allow_delivery_verify', 'on', true)`;
        return tx`
          insert into trip_student (
            tenant_id, trip_id, student_id, delivery_target,
            delivery_method, delivery_verified_at
          ) values (
            ${world.tenantA}, ${world.tripId}, ${world.studentId}, 'TEMP',
            'OTP', now()
          )
        `;
      }),
    ).rejects.toThrow(/delivery_columns_are_protected/);
  });

  it('HOME teslimatta OTP doğrulaması reddedilir', async () => {
    const world = await insertWorld(harness.sql);
    const overrideId = randomUUID();
    await harness.sql`
      insert into delivery_override (
        id, tenant_id, student_id, service_date, address_id,
        receiver_name, receiver_phone, otp_hmac, otp_ciphertext, status
      ) values (
        ${overrideId}, ${world.tenantA}, ${world.studentId}, '2026-09-09', ${world.addressId},
        'Teyze', '+905321119997', '\\x00'::bytea, '\\x01'::bytea, 'ACTIVE'
      )
    `;

    await expect(
      withOtpOk(
        harness.sql,
        world.tenantA,
        (tx) =>
          tx`select mark_delivery_verified(${overrideId}::uuid, ${world.tripStudentId}::uuid)`,
      ),
    ).rejects.toThrow(/delivery_override_not_temp/);
  });

  it('mark_delivery_verified GUC olmadan çalışmaz', async () => {
    const world = await insertWorld(harness.sql);
    const overrideId = randomUUID();
    await harness.sql`
      insert into delivery_override (
        id, tenant_id, student_id, service_date, address_id,
        receiver_name, receiver_phone, otp_hmac, otp_ciphertext, status
      ) values (
        ${overrideId}, ${world.tenantA}, ${world.studentId}, '2026-09-09', ${world.addressId},
        'Teyze', '+905321119996', '\\x00'::bytea, '\\x01'::bytea, 'ACTIVE'
      )
    `;
    await harness.sql`
      update trip_student
      set state = 'ON_BOARD', delivery_target = 'TEMP', state_seq = 1
      where id = ${world.tripStudentId}
    `;
    await expect(
      asApi(
        harness.sql,
        world.tenantA,
        (tx) =>
          tx`select mark_delivery_verified(${overrideId}::uuid, ${world.tripStudentId}::uuid)`,
      ),
    ).rejects.toThrow(/delivery_otp_not_verified/);
  });

  it('admin_override_delivery ADMIN rolü olmadan çalışmaz', async () => {
    const world = await insertWorld(harness.sql);
    const overrideId = randomUUID();
    await harness.sql`
      insert into delivery_override (
        id, tenant_id, student_id, service_date, address_id,
        receiver_name, receiver_phone, otp_hmac, otp_ciphertext, status
      ) values (
        ${overrideId}, ${world.tenantA}, ${world.studentId}, '2026-09-09', ${world.addressId},
        'Teyze', '+905321119995', '\\x00'::bytea, '\\x01'::bytea, 'ACTIVE'
      )
    `;
    await expect(
      harness.sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${world.tenantA}, true)`;
        await tx`select set_config('app.role', 'DRIVER', true)`;
        await tx.unsafe('set local role servisapp_api');
        return tx`select admin_override_delivery(${overrideId}::uuid, ${world.tripStudentId}::uuid, 'acil')`;
      }),
    ).rejects.toThrow(/admin_override_forbidden/);
  });

  it('aynı telefon iki şirkette ayrı üyelik açar', async () => {
    const world = await insertWorld(harness.sql);
    const phone = `+9055${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;

    const first = await asApi(
      harness.sql,
      world.tenantA,
      (tx) => tx<{ id: string }[]>`select ensure_identity(${phone}, null, 'Ali Veli') as id`,
    );
    const second = await asApi(
      harness.sql,
      world.tenantB,
      (tx) => tx<{ id: string }[]>`select ensure_identity(${phone}, null, 'Ali Veli') as id`,
    );
    expect(first[0]?.id).toBeTruthy();
    expect(first[0]?.id).toBe(second[0]?.id);

    await asApi(
      harness.sql,
      world.tenantA,
      (tx) => tx`
        insert into tenant_membership (tenant_id, identity_id, status)
        values (${world.tenantA}, ${first[0]!.id}::uuid, 'INVITED')
      `,
    );
    await asApi(
      harness.sql,
      world.tenantB,
      (tx) => tx`
        insert into tenant_membership (tenant_id, identity_id, status)
        values (${world.tenantB}, ${second[0]!.id}::uuid, 'INVITED')
      `,
    );
  });

  it('servisapp_api platform ayarını değiştiremez ve kimlik INSERT edemez', async () => {
    const world = await insertWorld(harness.sql);
    await expect(
      asApi(
        harness.sql,
        world.tenantA,
        (tx) => tx`update platform_settings set min_supported_app_version = '9.9.9'`,
      ),
    ).rejects.toThrow(/permission denied/);

    const phone = `+9055${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
    await expect(
      asApi(
        harness.sql,
        world.tenantA,
        (tx) => tx`
          insert into identity (phone_e164, full_name)
          values (${phone}, 'Kaçak Kimlik')
        `,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('sefer CAS fonksiyonu', () => {
  it('API rolü lock+geçiş fonksiyonuyla ON_BOARD yazar, doğrudan UPDATE edemez', async () => {
    const world = await insertWorld(harness.sql);
    const locked = await asApi(
      harness.sql,
      world.tenantA,
      (tx) =>
        tx<{ result: { state: string; stateSeq: number } }[]>`
          select lock_trip_student_for_command(${world.tripStudentId}::uuid) as result
        `,
    );
    expect(locked[0]?.result.state).toBe('EXPECTED');
    expect(locked[0]?.result.stateSeq).toBe(0);
    expect(locked[0]?.result).toMatchObject({ handoverPolicy: 'GUARDIAN_REQUIRED' });

    const applied = await asApi(
      harness.sql,
      world.tenantA,
      (tx) =>
        tx<{ result: { applied: boolean; state: string; stateSeq: number } }[]>`
          select apply_student_state_transition(
            ${world.tripStudentId}::uuid,
            0,
            'EXPECTED',
            'ON_BOARD',
            40.99,
            29.03,
            null
          ) as result
        `,
    );
    expect(applied[0]?.result).toMatchObject({ applied: true, state: 'ON_BOARD', stateSeq: 1 });

    const undone = await asApi(
      harness.sql,
      world.tenantA,
      (tx) =>
        tx<{ result: { applied: boolean; state: string; stateSeq: number } }[]>`
          select apply_student_state_transition(
            ${world.tripStudentId}::uuid,
            1,
            'ON_BOARD',
            'EXPECTED',
            null,
            null,
            null
          ) as result
        `,
    );
    expect(undone[0]?.result).toMatchObject({ applied: true, state: 'EXPECTED', stateSeq: 2 });
    const [cleared] = await harness.sql<
      { boarded_at: Date | null; boarded_lat: number | null; boarded_lng: number | null }[]
    >`
      select boarded_at, boarded_lat, boarded_lng
      from trip_student
      where id = ${world.tripStudentId}
    `;
    expect(cleared?.boarded_at).toBeNull();
    expect(cleared?.boarded_lat).toBeNull();
    expect(cleared?.boarded_lng).toBeNull();

    const conflicted = await asApi(
      harness.sql,
      world.tenantA,
      (tx) =>
        tx<{ result: { applied: boolean; reason: string } }[]>`
          select apply_student_state_transition(
            ${world.tripStudentId}::uuid,
            0,
            'EXPECTED',
            'NO_SHOW',
            null,
            null,
            null
          ) as result
        `,
    );
    expect(conflicted[0]?.result.applied).toBe(false);
    expect(conflicted[0]?.result.reason).toBe('conflict');

    const [flagged] = await harness.sql<{ needs_review: boolean }[]>`
      select needs_review from trip_student where id = ${world.tripStudentId}
    `;
    expect(flagged?.needs_review).toBe(true);

    await expect(
      asApi(
        harness.sql,
        world.tenantA,
        (tx) => tx`
          update trip_student
          set state = 'NO_SHOW'
          where id = ${world.tripStudentId}::uuid
        `,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('sonradan binen çocuk sefer sonu boş onayını düşürür', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      insert into trip_vehicle_check (tenant_id, trip_id, phase, checked_by, vehicle_empty_confirmed)
      values (${world.tenantA}, ${world.tripId}, 'AFTER', ${world.membershipId}, true)
    `;

    await asApi(
      harness.sql,
      world.tenantA,
      (tx) =>
        tx`select apply_student_state_transition(
          ${world.tripStudentId}::uuid,
          0,
          'EXPECTED',
          'ON_BOARD',
          null,
          null,
          null
        )`,
    );

    const [check] = await harness.sql<{ vehicle_empty_confirmed: boolean }[]>`
      select vehicle_empty_confirmed
      from trip_vehicle_check
      where trip_id = ${world.tripId} and phase = 'AFTER'
    `;
    expect(check?.vehicle_empty_confirmed).toBe(false);

    await expect(
      asApi(harness.sql, world.tenantA, (tx) => tx`select complete_trip(${world.tripId}::uuid)`),
    ).rejects.toThrow(/vehicle_sweep_not_confirmed|students_still_on_trip/);
  });

  it('API list_tenants_for_jobs çalıştıramaz; worker çalıştırır', async () => {
    const world = await insertWorld(harness.sql);
    await expect(
      asApi(harness.sql, world.tenantA, (tx) => tx`select * from list_tenants_for_jobs()`),
    ).rejects.toThrow(/permission denied/);

    const rows = await harness.sql.begin(async (tx) => {
      await tx.unsafe('set local role servisapp_worker');
      return tx<{ id: string }[]>`select id from list_tenants_for_jobs()`;
    });
    expect(rows.some((row) => row.id === world.tenantA)).toBe(true);
  });
});

describe('rota sürüm emniyeti', () => {
  it('aynı rotada ikinci taslak yazılamaz', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      insert into route_version (tenant_id, route_id, version_no, status, effective_from)
      values (${world.tenantA}, ${world.routeId}, 2, 'DRAFT', '2026-09-10')
    `;
    await expect(
      harness.sql`
        insert into route_version (tenant_id, route_id, version_no, status, effective_from)
        values (${world.tenantA}, ${world.routeId}, 3, 'DRAFT', '2026-09-11')
      `,
    ).rejects.toThrow(/route_version_one_draft/);
  });

  it('aynı durak bir sürümde iki kez duramaz', async () => {
    const world = await insertWorld(harness.sql);
    const [version] = await harness.sql<{ id: string }[]>`
      select id from route_version where route_id = ${world.routeId}
    `;
    if (!version) throw new Error('rota sürümü yok');
    await harness.sql`
      insert into route_stop (tenant_id, route_version_id, stop_id, seq, kind)
      values (${world.tenantA}, ${version.id}, ${world.stopId}, 1, 'PICKUP')
    `;
    await expect(
      harness.sql`
        insert into route_stop (tenant_id, route_version_id, stop_id, seq, kind)
        values (${world.tenantA}, ${version.id}, ${world.stopId}, 2, 'SCHOOL')
      `,
    ).rejects.toThrow(/route_stop_stop/);
  });
});

describe('OTP ve plan koruması', () => {
  it('API mevcut OTP hmac değerini değiştiremez', async () => {
    const world = await insertWorld(harness.sql);
    const overrideId = randomUUID();
    await harness.sql`
      insert into delivery_override (
        id, tenant_id, student_id, service_date, address_id,
        receiver_name, receiver_phone, otp_hmac, otp_ciphertext, status
      ) values (
        ${overrideId}, ${world.tenantA}, ${world.studentId}, '2026-09-09', ${world.addressId},
        'Teyze', '+905321119997', '\\x00'::bytea, '\\x01'::bytea, 'ACTIVE'
      )
    `;
    await expect(
      asApi(
        harness.sql,
        world.tenantA,
        (tx) =>
          tx`update delivery_override set otp_hmac = '\\x02'::bytea where id = ${overrideId}`,
      ),
    ).rejects.toThrow(/otp_columns_are_protected/);
  });

  it('operasyon gerçeğinde plan dropoff yazılamaz', async () => {
    const world = await insertWorld(harness.sql);
    await harness.sql`
      update trip_student set state = 'ON_BOARD', state_seq = 1
      where id = ${world.tripStudentId}
    `;
    const [row] = await asApi(
      harness.sql,
      world.tenantA,
      (tx) =>
        tx<{ result: { applied: boolean; reason: string } }[]>`
          select apply_trip_student_plan(
            ${world.tripStudentId}::uuid,
            false, 'EXPECTED'::student_state,
            false, 'HOME'::delivery_target,
            false, false,
            false, null,
            true, 40.1, 29.1, 'yanlış adres'
          ) as result
        `,
    );
    expect(row?.result).toMatchObject({ applied: false, reason: 'operational_fact' });
  });
});
