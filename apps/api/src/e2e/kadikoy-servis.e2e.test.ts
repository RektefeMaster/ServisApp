import { randomUUID } from 'node:crypto';
import { applyMigrations, createSql } from '@servisapp/db';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createPostgresData } from '../data/postgres.js';
import type { Env } from '../env.js';
import { startE2ePostgres, stopE2ePostgres, type E2ePostgres } from './harness.js';

/**
 * Gerçek dünya: Kadıköy'de iki servis şirketi aynı sabah sisteme girer.
 * Veriler uydurmadır; hosted Auth/SMS'e yazılmaz. HTTP + LOGIN rolü + RLS.
 */

const env: Env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  PORT: 0,
  DATABASE_URL: 'postgresql://localhost/test',
  WORKER_DATABASE_URL: 'postgresql://localhost/test',
  SUPABASE_URL: 'https://e2e.supabase.co',
  SUPABASE_JWT_SECRET: 'e2e-jwt-secret-onalti-karakter',
  OTP_PEPPER: 'e2e-pepper-en-az-otuziki-karakterxxxx',
  OTP_ENCRYPTION_KEY: 'e2e-enc-key-en-az-otuziki-karakterx',
  ADMIN_ORIGINS: 'http://127.0.0.1:3001,http://localhost:3001',
};

const GUNES = {
  name: 'Güneş Işığı Servis',
  admin: {
    fullName: 'Selin Karaca',
    phone: '+905321110001',
    email: 'selin.karaca@gunesis.net',
  },
  driver: {
    fullName: 'Hasan Yıldız',
    phone: '+905321110002',
    email: 'hasan.yildiz@gunesis.net',
  },
  attendant: {
    fullName: 'Elif Koç',
    phone: '+905321110003',
    email: 'elif.koc@gunesis.net',
  },
  guardian: {
    fullName: 'Ayşe Demir',
    phone: '+905321110004',
    relation: 'Anne',
  },
  student: {
    fullName: 'Efe Demir',
    grade: '2-B',
  },
  studentAda: {
    fullName: 'Ada Demir',
    grade: '4-A',
  },
  studentCan: {
    fullName: 'Can Yılmaz',
    grade: '1-C',
  },
} as const;

const MAVI = {
  name: 'Mavi Vadi Servis',
  admin: {
    fullName: 'Deniz Aksoy',
    phone: '+905321110099',
    email: 'deniz.aksoy@mavivadi.net',
  },
} as const;

const ISSUER = `${env.SUPABASE_URL}/auth/v1`;

interface CompanySeed {
  tenantId: string;
  identityId: string;
  membershipId: string;
}

interface World {
  gunes: CompanySeed;
  mavi: CompanySeed;
  selinAuthId: string;
  hasanAuthId: string;
  elifAuthId: string;
  ayseAuthId: string;
  denizAuthId: string;
  schoolAddressId: string;
  homeAddressId: string;
  schoolId: string;
  vehicleId: string;
  maviVehicleId: string;
  studentId: string;
  driverMembershipId: string;
  guardianMembershipId: string;
  schoolStopId: string;
  homeStopId: string;
  adaAddressId: string;
  adaStopId: string;
  canAddressId: string;
  canStopId: string;
  adaStudentId: string;
  canStudentId: string;
  secondSchoolId: string;
  mertStudentId: string;
  routeId: string;
  draftVersionId: string;
  publishedVersionId: string;
  afternoonRouteId: string;
  minibusId: string;
  minibusDraftId: string;
  maviStopId: string;
  maviSchoolId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} yok: ${JSON.stringify(body)}`);
  }
  return value;
}

function requireItems(body: Record<string, unknown>): Record<string, unknown>[] {
  const items = body['items'];
  if (!Array.isArray(items)) throw new Error(`items yok: ${JSON.stringify(body)}`);
  return items.map((item, index) => {
    if (!isRecord(item)) throw new Error(`items[${index}] nesne değil`);
    return item;
  });
}

function requireStops(body: Record<string, unknown>): Record<string, unknown>[] {
  const stops = body['stops'];
  if (!Array.isArray(stops)) throw new Error(`stops yok: ${JSON.stringify(body)}`);
  return stops.map((item, index) => {
    if (!isRecord(item)) throw new Error(`stops[${index}] nesne değil`);
    return item;
  });
}

function stopIdsInSeq(body: Record<string, unknown>): string[] {
  return requireStops(body)
    .slice()
    .sort((a, b) => Number(a['seq']) - Number(b['seq']))
    .map((row) => requireString(row, 'stopId'));
}

function studentIdsOf(body: Record<string, unknown>): string[] {
  return requireStops(body).flatMap((row) => {
    const ids = row['studentIds'];
    if (!Array.isArray(ids)) return [];
    return ids.filter((id): id is string => typeof id === 'string');
  });
}

function expectMembership(
  body: Record<string, unknown>,
  expected: {
    status: string;
    role: string;
    tenantId?: string;
    tenantName?: string;
    membershipId?: string;
  },
): void {
  const memberships = body['memberships'];
  if (!Array.isArray(memberships)) throw new Error(`memberships yok: ${JSON.stringify(body)}`);
  const rows: unknown[] = memberships;
  const match = rows.find((item) => {
    if (!isRecord(item)) return false;
    if (expected.membershipId && item['membershipId'] !== expected.membershipId) return false;
    if (expected.tenantId && item['tenantId'] !== expected.tenantId) return false;
    if (expected.tenantName && item['tenantName'] !== expected.tenantName) return false;
    const roles = item['roles'];
    return (
      item['status'] === expected.status && Array.isArray(roles) && roles.includes(expected.role)
    );
  });
  expect(match, JSON.stringify(rows)).toBeTruthy();
}

async function mint(input: {
  sub: string;
  phone?: string;
  email?: string;
  extra?: Record<string, unknown>;
}): Promise<string> {
  return new SignJWT({
    role: 'authenticated',
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.email ? { email: input.email, email_verified: true } : {}),
    ...input.extra,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.sub)
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(env.SUPABASE_JWT_SECRET));
}

async function seedCompany(
  sql: E2ePostgres['sql'],
  name: string,
  admin: { fullName: string; phone: string; email: string },
): Promise<CompanySeed> {
  const [tenant] = await sql<{ id: string }[]>`
    insert into tenant (name) values (${name}) returning id
  `;
  if (!tenant) throw new Error('tenant insert');
  const [identity] = await sql<{ id: string }[]>`
    insert into identity (phone_e164, email, full_name)
    values (${admin.phone}, ${admin.email}, ${admin.fullName})
    returning id
  `;
  if (!identity) throw new Error('identity insert');
  const [membership] = await sql<{ id: string }[]>`
    insert into tenant_membership (tenant_id, identity_id, status)
    values (${tenant.id}::uuid, ${identity.id}::uuid, 'ACTIVE')
    returning id
  `;
  if (!membership) throw new Error('membership insert');
  await sql`
    insert into membership_role (tenant_id, membership_id, role)
    values (${tenant.id}::uuid, ${membership.id}::uuid, 'ADMIN')
  `;
  return { tenantId: tenant.id, identityId: identity.id, membershipId: membership.id };
}

describe('Kadıköy Güneş Işığı — ilk kurulum günü', { timeout: 120_000 }, () => {
  let postgres: E2ePostgres;
  let apiSql: ReturnType<typeof createSql>;
  let workerSql: ReturnType<typeof createSql>;
  let app: FastifyInstance;
  let world: World;

  async function request(
    method: 'GET' | 'POST' | 'PUT' | 'OPTIONS',
    url: string,
    headers: Record<string, string>,
    payload?: unknown,
  ): Promise<{
    status: number;
    body: Record<string, unknown>;
    header: (name: string) => string | undefined;
  }> {
    const inject: {
      method: 'GET' | 'POST' | 'PUT' | 'OPTIONS';
      url: string;
      headers: Record<string, string>;
      payload?: object;
    } = { method, url, headers };
    if (payload !== undefined && payload !== null && typeof payload === 'object') {
      inject.payload = payload;
    }
    const response = await app.inject(inject);
    let parsed: unknown = {};
    if (response.body.length > 0) {
      try {
        parsed = response.json();
      } catch {
        parsed = { raw: response.body };
      }
    }
    return {
      status: response.statusCode,
      body: isRecord(parsed) ? parsed : { value: parsed },
      header: (name) => {
        const value = response.headers[name];
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value[0];
        return undefined;
      },
    };
  }

  async function asUser(
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    actor: {
      token: string;
      client: 'admin' | 'crew' | 'parent';
      tenantId?: string;
      version?: string;
      extraHeaders?: Record<string, string>;
    },
    payload?: unknown,
  ) {
    const headers: Record<string, string> = {
      'x-client': actor.client,
      authorization: `Bearer ${actor.token}`,
      ...actor.extraHeaders,
    };
    if (actor.tenantId) headers['x-tenant-id'] = actor.tenantId;
    if (actor.client === 'crew' || actor.client === 'parent') {
      headers['x-app-version'] = actor.version ?? '1.4.2';
    }
    return request(method, url, headers, payload);
  }

  async function selinAdmin() {
    const token = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    return { token, client: 'admin' as const, tenantId: world.gunes.tenantId };
  }

  beforeAll(async () => {
    postgres = await startE2ePostgres();
    apiSql = createSql(postgres.apiUrl, 'api');
    workerSql = createSql(postgres.workerUrl, 'worker');
    const gunes = await seedCompany(postgres.sql, GUNES.name, GUNES.admin);
    const mavi = await seedCompany(postgres.sql, MAVI.name, MAVI.admin);
    world = {
      gunes,
      mavi,
      selinAuthId: randomUUID(),
      hasanAuthId: randomUUID(),
      elifAuthId: randomUUID(),
      ayseAuthId: randomUUID(),
      denizAuthId: randomUUID(),
      schoolAddressId: '',
      homeAddressId: '',
      schoolId: '',
      vehicleId: '',
      maviVehicleId: '',
      studentId: '',
      driverMembershipId: '',
      guardianMembershipId: '',
      schoolStopId: '',
      homeStopId: '',
      adaAddressId: '',
      adaStopId: '',
      canAddressId: '',
      canStopId: '',
      adaStudentId: '',
      canStudentId: '',
      secondSchoolId: '',
      mertStudentId: '',
      routeId: '',
      draftVersionId: '',
      publishedVersionId: '',
      afternoonRouteId: '',
      minibusId: '',
      minibusDraftId: '',
      maviStopId: '',
      maviSchoolId: '',
    };
    app = buildApp({
      env,
      data: createPostgresData(apiSql),
      health: {
        checkDatabase: async () => {
          await apiSql`select 1`;
        },
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (apiSql) await apiSql.end({ timeout: 5 });
    if (workerSql) await workerSql.end({ timeout: 5 });
    if (postgres) await stopE2ePostgres(postgres);
  });

  it('Fly sağlık kontrolü canlı ve hazır döner', async () => {
    const live = await request('GET', '/health/live', {});
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: 'ok' });
    expect(live.header('x-request-id')).toBeTruthy();

    const ready = await request('GET', '/health/ready', { 'x-request-id': 'crew-e2e-ready1' });
    expect(ready.status).toBe(200);
    expect(ready.header('x-request-id')).toBe('crew-e2e-ready1');
  });

  it('Selin paneli açmadan sürüm politikasını çeker', async () => {
    const anonymous = await request('GET', '/v1/config', {});
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toMatchObject({
      schemaVersion: 1,
      minSupportedAppVersion: '0.0.0',
      kills: { gps: false, otp: false, realtime: false },
    });

    const crew = await request('GET', '/v1/config', {
      'x-client': 'crew',
      'x-app-version': '1.4.2',
    });
    expect(crew.status).toBe(200);
  });

  it('migration ikinci kez no-op kalır', async () => {
    await applyMigrations(postgres.url);
    await applyMigrations(postgres.url);
    const files = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from schema_migrations
    `;
    expect(Number(files[0]?.n)).toBeGreaterThanOrEqual(8);
  });

  it('Selin SMS ile girer; ilk jeton kimliği bağlar', async () => {
    const token = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const session = await asUser('GET', '/v1/session', { token, client: 'admin' });
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({
      identityId: world.gunes.identityId,
      fullName: GUNES.admin.fullName,
    });
    expectMembership(session.body, {
      tenantId: world.gunes.tenantId,
      tenantName: GUNES.name,
      status: 'ACTIVE',
      role: 'ADMIN',
    });

    const [linked] = await postgres.sql<{ auth_user_id: string }[]>`
      select auth_user_id::text from identity where id = ${world.gunes.identityId}::uuid
    `;
    expect(linked?.auth_user_id).toBe(world.selinAuthId);
  });

  it('Selin okul ve ev adreslerini pinler, Güneş İlkokulu ve aracı kaydeder', async () => {
    const token = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const admin = { token, client: 'admin' as const, tenantId: world.gunes.tenantId };

    const schoolAddr = await asUser('POST', '/v1/admin/addresses', admin, {
      text: 'Caferağa Mah. Moda Cad. No:12',
      il: 'İstanbul',
      ilce: 'Kadıköy',
      lat: 40.9876,
      lng: 29.0264,
      geocodeConfidence: 0.94,
    });
    expect(schoolAddr.status).toBe(200);
    world.schoolAddressId = requireString(schoolAddr.body, 'id');

    const homeAddr = await asUser('POST', '/v1/admin/addresses', admin, {
      text: 'Erenköy Mah. Bağdat Cad. No:88 Daire:5',
      il: 'İstanbul',
      ilce: 'Kadıköy',
      lat: 40.9712,
      lng: 29.0755,
      geocodeConfidence: 0.91,
    });
    expect(homeAddr.status).toBe(200);
    world.homeAddressId = requireString(homeAddr.body, 'id');

    const school = await asUser('POST', '/v1/admin/schools', admin, {
      name: 'Güneş İlkokulu',
      level: 'PRIMARY',
      addressId: world.schoolAddressId,
      attendantRequired: true,
    });
    expect(school.status).toBe(200);
    world.schoolId = requireString(school.body, 'id');

    const vehicle = await asUser('POST', '/v1/admin/vehicles', admin, {
      plate: '34 GNS 142',
      seatCount: 16,
      modelYear: 2022,
      inspectionExpiry: '2027-03-31',
      insuranceExpiry: '2027-01-15',
    });
    expect(vehicle.status).toBe(200);
    world.vehicleId = requireString(vehicle.body, 'id');

    const duplicate = await asUser('POST', '/v1/admin/vehicles', admin, {
      plate: '34 GNS 142',
      seatCount: 16,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body['error']).toBe('duplicate');
  });

  it('Selin şoför, hostes, öğrenci ve veli tanımlar', async () => {
    const token = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const admin = { token, client: 'admin' as const, tenantId: world.gunes.tenantId };

    const driver = await asUser('POST', '/v1/admin/staff', admin, {
      fullName: GUNES.driver.fullName,
      phone: GUNES.driver.phone,
      email: GUNES.driver.email,
      role: 'DRIVER',
      vehicleId: world.vehicleId,
    });
    expect(driver.status).toBe(200);
    world.driverMembershipId = requireString(driver.body, 'membershipId');

    const [driverStatus] = await postgres.sql<{ status: string }[]>`
      select status::text from tenant_membership where id = ${world.driverMembershipId}::uuid
    `;
    expect(driverStatus?.status).toBe('INVITED');

    const attendant = await asUser('POST', '/v1/admin/staff', admin, {
      fullName: GUNES.attendant.fullName,
      phone: GUNES.attendant.phone,
      email: GUNES.attendant.email,
      role: 'ATTENDANT',
      vehicleId: world.vehicleId,
    });
    expect(attendant.status).toBe(200);

    const missingSchool = await asUser('POST', '/v1/admin/students', admin, {
      fullName: 'Hayalet Öğrenci',
      schoolId: randomUUID(),
      handoverPolicy: 'GUARDIAN_REQUIRED',
      enrollmentStart: '2026-09-01',
    });
    expect(missingSchool.status).toBe(400);
    expect(missingSchool.body['error']).toBe('invalid_reference');

    const student = await asUser('POST', '/v1/admin/students', admin, {
      fullName: GUNES.student.fullName,
      schoolId: world.schoolId,
      grade: GUNES.student.grade,
      handoverPolicy: 'GUARDIAN_REQUIRED',
      enrollmentStart: '2026-09-01',
      pickupAddressId: world.homeAddressId,
      dropoffAddressId: world.homeAddressId,
    });
    expect(student.status).toBe(200);
    world.studentId = requireString(student.body, 'id');

    const ghostGuardian = await asUser(
      'POST',
      `/v1/admin/students/${randomUUID()}/guardians`,
      admin,
      {
        fullName: 'Yanlış Veli',
        phone: '+905321110088',
        relation: 'Amca',
      },
    );
    expect(ghostGuardian.status).toBe(404);

    const guardian = await asUser(
      'POST',
      `/v1/admin/students/${world.studentId}/guardians`,
      admin,
      {
        fullName: GUNES.guardian.fullName,
        phone: GUNES.guardian.phone,
        relation: GUNES.guardian.relation,
        isPrimary: true,
        canReceiveChild: true,
        canAuthorizeTempAddress: true,
        canSubmitException: true,
        notifyAm: true,
        notifyPm: true,
      },
    );
    expect(guardian.status).toBe(200);
    world.guardianMembershipId = requireString(guardian.body, 'membershipId');

    const addresses = await asUser('GET', '/v1/admin/addresses', admin);
    expect(addresses.status).toBe(200);
    expect(requireItems(addresses.body)).toHaveLength(2);

    const schools = await asUser('GET', '/v1/admin/schools', admin);
    expect(schools.status).toBe(200);
    expect(requireItems(schools.body)).toEqual([
      expect.objectContaining({ id: world.schoolId, name: 'Güneş İlkokulu', level: 'PRIMARY' }),
    ]);

    const vehicles = await asUser('GET', '/v1/admin/vehicles', admin);
    expect(vehicles.status).toBe(200);
    expect(requireItems(vehicles.body)).toEqual([
      expect.objectContaining({ id: world.vehicleId, plate: '34 GNS 142', seatCount: 16 }),
    ]);

    const students = await asUser('GET', '/v1/admin/students', admin);
    expect(students.status).toBe(200);
    expect(requireItems(students.body)).toEqual([
      expect.objectContaining({
        id: world.studentId,
        fullName: GUNES.student.fullName,
        schoolId: world.schoolId,
      }),
    ]);

    const assignments = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from staff_assignment
      where tenant_id = ${world.gunes.tenantId}::uuid and vehicle_id = ${world.vehicleId}::uuid
    `;
    expect(assignments[0]?.n).toBe('2');

    const studentAddresses = await postgres.sql<{ usage: string }[]>`
      select usage::text from student_address
      where student_id = ${world.studentId}::uuid
      order by usage
    `;
    expect(studentAddresses.map((row) => row.usage)).toEqual(['DROPOFF', 'PICKUP']);
  });

  it('Selin sabah rotasını kurar, sıralar ve yayınlar', async () => {
    const token = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const admin = { token, client: 'admin' as const, tenantId: world.gunes.tenantId };

    const schoolStop = await asUser('POST', '/v1/admin/stops', admin, {
      addressId: world.schoolAddressId,
      label: 'Güneş İlkokulu kapı',
      lat: 40.9877,
      lng: 29.0265,
    });
    expect(schoolStop.status).toBe(200);
    world.schoolStopId = requireString(schoolStop.body, 'id');

    const homeStop = await asUser('POST', '/v1/admin/stops', admin, {
      addressId: world.homeAddressId,
      label: 'Demir apt. önü',
      lat: 40.9713,
      lng: 29.0756,
    });
    expect(homeStop.status).toBe(200);
    world.homeStopId = requireString(homeStop.body, 'id');

    const listedStops = await asUser('GET', '/v1/admin/stops', admin);
    expect(listedStops.status).toBe(200);
    expect(new Set(requireItems(listedStops.body).map((row) => row['id']))).toEqual(
      new Set([world.schoolStopId, world.homeStopId]),
    );

    const created = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: world.vehicleId,
      schoolId: world.schoolId,
      segment: 'MORNING',
      shiftNo: 1,
      effectiveFrom: '2026-09-09',
    });
    expect(created.status).toBe(200);
    world.routeId = requireString(created.body, 'id');
    world.draftVersionId = requireString(created.body, 'draftVersionId');

    const emptyPublish = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.draftVersionId}/publish`,
      admin,
    );
    expect(emptyPublish.status).toBe(400);
    expect(emptyPublish.body['error']).toBe('empty_route');

    const emptySuggest = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.draftVersionId}/suggest-order`,
      admin,
    );
    expect(emptySuggest.status).toBe(400);
    expect(emptySuggest.body['error']).toBe('missing_school_stop');

    const duplicate = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: world.vehicleId,
      schoolId: world.schoolId,
      segment: 'MORNING',
      shiftNo: 1,
      effectiveFrom: '2026-09-09',
    });
    expect(duplicate.status).toBe(409);

    const incomplete = await asUser(
      'PUT',
      `/v1/admin/route-versions/${world.draftVersionId}/stops`,
      admin,
      {
        stops: [
          {
            stopId: world.schoolStopId,
            kind: 'SCHOOL',
            seq: 1,
            studentIds: [],
          },
        ],
      },
    );
    expect(incomplete.status).toBe(200);

    const tooSoon = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.draftVersionId}/publish`,
      admin,
    );
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.body['error']).toBe('need_passenger_stop');

    const suggestSchoolOnly = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.draftVersionId}/suggest-order`,
      admin,
    );
    expect(suggestSchoolOnly.status).toBe(400);
    expect(suggestSchoolOnly.body['error']).toBe('need_passenger_stop');

    const filled = await asUser(
      'PUT',
      `/v1/admin/route-versions/${world.draftVersionId}/stops`,
      admin,
      {
        stops: [
          {
            stopId: world.homeStopId,
            kind: 'PICKUP',
            seq: 1,
            studentIds: [world.studentId],
          },
          {
            stopId: world.schoolStopId,
            kind: 'SCHOOL',
            seq: 2,
            studentIds: [],
          },
        ],
      },
    );
    expect(filled.status).toBe(200);
    expect(filled.body['status']).toBe('DRAFT');

    const stillDraftClone = await asUser(
      'POST',
      `/v1/admin/routes/${world.routeId}/versions`,
      admin,
      {},
    );
    expect(stillDraftClone.status).toBe(409);
    expect(stillDraftClone.body['error']).toBe('draft_exists');

    const suggested = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.draftVersionId}/suggest-order`,
      admin,
    );
    expect(suggested.status).toBe(200);
    expect(stopIdsInSeq(suggested.body)).toEqual([world.homeStopId, world.schoolStopId]);
    expect(requireStops(suggested.body).at(-1)?.['kind']).toBe('SCHOOL');

    const published = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.draftVersionId}/publish`,
      admin,
    );
    expect(published.status).toBe(200);
    expect(published.body['status']).toBe('PUBLISHED');
    expect(published.body['effectiveFrom']).toBe('2026-09-09');
    world.publishedVersionId = requireString(published.body, 'id');

    const locked = await asUser(
      'PUT',
      `/v1/admin/route-versions/${world.draftVersionId}/stops`,
      admin,
      {
        stops: [
          {
            stopId: world.homeStopId,
            kind: 'PICKUP',
            seq: 1,
            studentIds: [world.studentId],
          },
          {
            stopId: world.schoolStopId,
            kind: 'SCHOOL',
            seq: 2,
            studentIds: [],
          },
        ],
      },
    );
    expect(locked.status).toBe(409);
    expect(locked.body['error']).toBe('version_not_draft');

    const suggestPublished = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.draftVersionId}/suggest-order`,
      admin,
    );
    expect(suggestPublished.status).toBe(409);
    expect(suggestPublished.body['error']).toBe('version_not_draft');

    const detail = await asUser('GET', `/v1/admin/routes/${world.routeId}`, admin);
    expect(detail.status).toBe(200);
    expect(detail.body['versions']).toEqual([
      expect.objectContaining({
        id: world.publishedVersionId,
        versionNo: 1,
        status: 'PUBLISHED',
        effectiveFrom: '2026-09-09',
      }),
    ]);

    const listed = await asUser('GET', '/v1/admin/routes', admin);
    expect(listed.status).toBe(200);
    const routes = requireItems(listed.body);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.['id']).toBe(world.routeId);
    expect(routes[0]?.['publishedVersionId']).toBe(world.publishedVersionId);
    expect(routes[0]?.['draftVersionId']).toBeNull();
  });

  it('Selin Ada ve Can’ı ekler; sıra önerisi en uzaktan okula toplar', async () => {
    const token = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const admin = { token, client: 'admin' as const, tenantId: world.gunes.tenantId };

    const adaAddr = await asUser('POST', '/v1/admin/addresses', admin, {
      text: 'Fenerbahçe Mah. Yoğurtçu Parkı Cad. No:4',
      il: 'İstanbul',
      ilce: 'Kadıköy',
      lat: 40.9681,
      lng: 29.12,
    });
    expect(adaAddr.status).toBe(200);
    world.adaAddressId = requireString(adaAddr.body, 'id');

    const canAddr = await asUser('POST', '/v1/admin/addresses', admin, {
      text: 'Caferağa Mah. Mühürdar Cad. No:9',
      il: 'İstanbul',
      ilce: 'Kadıköy',
      lat: 40.9802,
      lng: 29.045,
    });
    expect(canAddr.status).toBe(200);
    world.canAddressId = requireString(canAddr.body, 'id');

    const ada = await asUser('POST', '/v1/admin/students', admin, {
      fullName: GUNES.studentAda.fullName,
      schoolId: world.schoolId,
      grade: GUNES.studentAda.grade,
      handoverPolicy: 'GUARDIAN_REQUIRED',
      enrollmentStart: '2026-09-01',
      pickupAddressId: world.adaAddressId,
      dropoffAddressId: world.adaAddressId,
    });
    expect(ada.status).toBe(200);
    world.adaStudentId = requireString(ada.body, 'id');

    const can = await asUser('POST', '/v1/admin/students', admin, {
      fullName: GUNES.studentCan.fullName,
      schoolId: world.schoolId,
      grade: GUNES.studentCan.grade,
      handoverPolicy: 'GUARDIAN_REQUIRED',
      enrollmentStart: '2026-09-01',
      pickupAddressId: world.canAddressId,
      dropoffAddressId: world.canAddressId,
    });
    expect(can.status).toBe(200);
    world.canStudentId = requireString(can.body, 'id');

    const adaStop = await asUser('POST', '/v1/admin/stops', admin, {
      addressId: world.adaAddressId,
      label: 'Fenerbahçe park önü',
      lat: 40.9682,
      lng: 29.1201,
    });
    expect(adaStop.status).toBe(200);
    world.adaStopId = requireString(adaStop.body, 'id');

    const canStop = await asUser('POST', '/v1/admin/stops', admin, {
      addressId: world.canAddressId,
      label: 'Mühürdar köşe',
      lat: 40.9803,
      lng: 29.0451,
    });
    expect(canStop.status).toBe(200);
    world.canStopId = requireString(canStop.body, 'id');

    const cloned = await asUser('POST', `/v1/admin/routes/${world.routeId}/versions`, admin, {});
    expect(cloned.status).toBe(200);
    expect(cloned.body['versionNo']).toBe(2);
    const draftId = requireString(cloned.body, 'id');

    const copied = await asUser('GET', `/v1/admin/route-versions/${draftId}`, admin);
    expect(copied.status).toBe(200);
    expect(copied.body['status']).toBe('DRAFT');
    expect(studentIdsOf(copied.body)).toEqual([world.studentId]);

    const secondClone = await asUser(
      'POST',
      `/v1/admin/routes/${world.routeId}/versions`,
      admin,
      {},
    );
    expect(secondClone.status).toBe(409);
    expect(secondClone.body['error']).toBe('draft_exists');

    const shuffled = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.canStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.canStudentId],
        },
        {
          stopId: world.adaStopId,
          kind: 'PICKUP',
          seq: 2,
          studentIds: [world.adaStudentId],
        },
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 3,
          studentIds: [world.studentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 4,
          studentIds: [],
        },
      ],
    });
    expect(shuffled.status).toBe(200);

    const suggested = await asUser(
      'POST',
      `/v1/admin/route-versions/${draftId}/suggest-order`,
      admin,
    );
    expect(suggested.status).toBe(200);
    expect(stopIdsInSeq(suggested.body)).toEqual([
      world.adaStopId,
      world.homeStopId,
      world.canStopId,
      world.schoolStopId,
    ]);

    const published = await asUser('POST', `/v1/admin/route-versions/${draftId}/publish`, admin);
    expect(published.status).toBe(200);
    expect(published.body['status']).toBe('PUBLISHED');
    expect(published.body['effectiveFrom']).toBe('2026-09-09');
    world.publishedVersionId = requireString(published.body, 'id');
    world.draftVersionId = draftId;

    const detail = await asUser('GET', `/v1/admin/routes/${world.routeId}`, admin);
    expect(detail.status).toBe(200);
    const versions = detail.body['versions'];
    expect(Array.isArray(versions)).toBe(true);
    expect(versions).toEqual([
      expect.objectContaining({ versionNo: 1, status: 'ARCHIVED', effectiveFrom: '2026-09-09' }),
      expect.objectContaining({
        id: world.publishedVersionId,
        versionNo: 2,
        status: 'PUBLISHED',
        effectiveFrom: '2026-09-09',
      }),
    ]);

    const [publishedCount] = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from route_version
      where route_id = ${world.routeId}::uuid and status = 'PUBLISHED'
    `;
    expect(publishedCount?.n).toBe('1');
  });

  it('sabah rotasına bırakma durağı yazılamaz; taslak yayınlıdan kopyalanır', async () => {
    const token = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const admin = { token, client: 'admin' as const, tenantId: world.gunes.tenantId };

    const cloned = await asUser('POST', `/v1/admin/routes/${world.routeId}/versions`, admin, {});
    expect(cloned.status).toBe(200);
    expect(cloned.body['versionNo']).toBe(3);
    const draftId = requireString(cloned.body, 'id');

    const fromArchived = await asUser(
      'POST',
      `/v1/admin/routes/${world.routeId}/versions`,
      admin,
      { fromVersionId: world.draftVersionId },
    );
    expect(fromArchived.status).toBe(409);
    expect(fromArchived.body['error']).toBe('draft_exists');

    const wrongKind = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.homeStopId,
          kind: 'DROPOFF',
          seq: 1,
          studentIds: [world.studentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 2,
          studentIds: [],
        },
      ],
    });
    expect(wrongKind.status).toBe(200);

    const publishWrong = await asUser('POST', `/v1/admin/route-versions/${draftId}/publish`, admin);
    expect(publishWrong.status).toBe(400);
    expect(publishWrong.body['error']).toBe('wrong_stop_kind');

    const seqGap = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.studentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 3,
          studentIds: [],
        },
      ],
    });
    expect(seqGap.status).toBe(400);
    expect(seqGap.body['error']).toBe('invalid_sequence');

    const duplicateStop = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.studentId],
        },
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 2,
          studentIds: [world.adaStudentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 3,
          studentIds: [],
        },
      ],
    });
    expect(duplicateStop.status).toBe(400);
    expect(duplicateStop.body['error']).toBe('duplicate_stop');

    const studentOnSchool = await asUser(
      'PUT',
      `/v1/admin/route-versions/${draftId}/stops`,
      admin,
      {
        stops: [
          {
            stopId: world.homeStopId,
            kind: 'PICKUP',
            seq: 1,
            studentIds: [world.studentId],
          },
          {
            stopId: world.schoolStopId,
            kind: 'SCHOOL',
            seq: 2,
            studentIds: [world.adaStudentId],
          },
        ],
      },
    );
    expect(studentOnSchool.status).toBe(400);
    expect(studentOnSchool.body['error']).toBe('student_on_school_stop');

    const duplicateStudent = await asUser(
      'PUT',
      `/v1/admin/route-versions/${draftId}/stops`,
      admin,
      {
        stops: [
          {
            stopId: world.homeStopId,
            kind: 'PICKUP',
            seq: 1,
            studentIds: [world.studentId],
          },
          {
            stopId: world.adaStopId,
            kind: 'PICKUP',
            seq: 2,
            studentIds: [world.studentId],
          },
          {
            stopId: world.schoolStopId,
            kind: 'SCHOOL',
            seq: 3,
            studentIds: [],
          },
        ],
      },
    );
    expect(duplicateStudent.status).toBe(400);
    expect(duplicateStudent.body['error']).toBe('duplicate_student');

    const restored = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.adaStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.adaStudentId],
        },
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 2,
          studentIds: [world.studentId],
        },
        {
          stopId: world.canStopId,
          kind: 'PICKUP',
          seq: 3,
          studentIds: [world.canStudentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 4,
          studentIds: [],
        },
      ],
    });
    expect(restored.status).toBe(200);

    const published = await asUser('POST', `/v1/admin/route-versions/${draftId}/publish`, admin);
    expect(published.status).toBe(200);
    world.publishedVersionId = requireString(published.body, 'id');

    const history = await asUser('GET', `/v1/admin/routes/${world.routeId}`, admin);
    expect(history.status).toBe(200);
    const versions = history.body['versions'];
    if (!Array.isArray(versions) || !isRecord(versions[0])) {
      throw new Error('sürüm geçmişi yok');
    }
    const archivedV1 = requireString(versions[0], 'id');
    expect(versions[0]?.['status']).toBe('ARCHIVED');

    const fromOld = await asUser('POST', `/v1/admin/routes/${world.routeId}/versions`, admin, {
      fromVersionId: archivedV1,
    });
    expect(fromOld.status).toBe(200);
    expect(fromOld.body['versionNo']).toBe(4);
    const rollbackDraft = requireString(fromOld.body, 'id');
    const rollbackView = await asUser('GET', `/v1/admin/route-versions/${rollbackDraft}`, admin);
    expect(rollbackView.status).toBe(200);
    expect(stopIdsInSeq(rollbackView.body)).toEqual([world.homeStopId, world.schoolStopId]);
    expect(studentIdsOf(rollbackView.body)).toEqual([world.studentId]);

    const publishedOld = await asUser(
      'POST',
      `/v1/admin/route-versions/${rollbackDraft}/publish`,
      admin,
    );
    expect(publishedOld.status).toBe(200);
    world.publishedVersionId = requireString(publishedOld.body, 'id');
  });

  it('aynı araçla akşam bırakma rotası yayınlanır', async () => {
    const token = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const admin = { token, client: 'admin' as const, tenantId: world.gunes.tenantId };

    const created = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: world.vehicleId,
      schoolId: world.schoolId,
      segment: 'AFTERNOON',
      shiftNo: 1,
      effectiveFrom: '2026-09-09',
    });
    expect(created.status).toBe(200);
    world.afternoonRouteId = requireString(created.body, 'id');
    const draftId = requireString(created.body, 'draftVersionId');

    const schoolFirst = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.homeStopId,
          kind: 'DROPOFF',
          seq: 1,
          studentIds: [world.studentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 2,
          studentIds: [],
        },
      ],
    });
    expect(schoolFirst.status).toBe(200);
    const publishSchoolLast = await asUser(
      'POST',
      `/v1/admin/route-versions/${draftId}/publish`,
      admin,
    );
    expect(publishSchoolLast.status).toBe(400);
    expect(publishSchoolLast.body['error']).toBe('school_position');

    const filled = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 1,
          studentIds: [],
        },
        {
          stopId: world.canStopId,
          kind: 'DROPOFF',
          seq: 2,
          studentIds: [world.canStudentId],
        },
        {
          stopId: world.homeStopId,
          kind: 'DROPOFF',
          seq: 3,
          studentIds: [world.studentId],
        },
        {
          stopId: world.adaStopId,
          kind: 'DROPOFF',
          seq: 4,
          studentIds: [world.adaStudentId],
        },
      ],
    });
    expect(filled.status).toBe(200);

    const suggested = await asUser(
      'POST',
      `/v1/admin/route-versions/${draftId}/suggest-order`,
      admin,
    );
    expect(suggested.status).toBe(200);
    expect(stopIdsInSeq(suggested.body)[0]).toBe(world.schoolStopId);
    expect(requireStops(suggested.body)[0]?.['kind']).toBe('SCHOOL');
    expect(stopIdsInSeq(suggested.body)).toEqual([
      world.schoolStopId,
      world.canStopId,
      world.homeStopId,
      world.adaStopId,
    ]);

    const published = await asUser('POST', `/v1/admin/route-versions/${draftId}/publish`, admin);
    expect(published.status).toBe(200);
    expect(published.body['status']).toBe('PUBLISHED');
    expect(published.body['segment']).toBe('AFTERNOON');

    const duplicateShift = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: world.vehicleId,
      schoolId: world.schoolId,
      segment: 'AFTERNOON',
      shiftNo: 1,
      effectiveFrom: '2026-09-09',
    });
    expect(duplicateShift.status).toBe(409);
  });

  it('kardeşler aynı kapı durağından biner', async () => {
    const admin = await selinAdmin();
    const cloned = await asUser('POST', `/v1/admin/routes/${world.routeId}/versions`, admin, {});
    expect(cloned.status).toBe(200);
    const draftId = requireString(cloned.body, 'id');

    const together = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.adaStudentId, world.studentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 2,
          studentIds: [],
        },
      ],
    });
    expect(together.status).toBe(200);
    const home = requireStops(together.body).find((row) => row['stopId'] === world.homeStopId);
    expect(home).toBeTruthy();
    const ids = Array.isArray(home?.['studentIds'])
      ? home['studentIds'].filter((id): id is string => typeof id === 'string')
      : [];
    expect(new Set(ids)).toEqual(new Set([world.studentId, world.adaStudentId]));

    const published = await asUser('POST', `/v1/admin/route-versions/${draftId}/publish`, admin);
    expect(published.status).toBe(200);
    expect(published.body['status']).toBe('PUBLISHED');
    world.publishedVersionId = requireString(published.body, 'id');
    expect(studentIdsOf(published.body)).toEqual(
      [world.adaStudentId, world.studentId].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('tek koltuklu minibüse iki çocuk sığmaz; başka okulun öğrencisi binemez', async () => {
    const token = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const admin = { token, client: 'admin' as const, tenantId: world.gunes.tenantId };

    const minibus = await asUser('POST', '/v1/admin/vehicles', admin, {
      plate: '34 GNS 01',
      seatCount: 1,
    });
    expect(minibus.status).toBe(200);
    world.minibusId = requireString(minibus.body, 'id');

    const created = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: world.minibusId,
      schoolId: world.schoolId,
      segment: 'MORNING',
      shiftNo: 1,
      effectiveFrom: '2026-09-09',
    });
    expect(created.status).toBe(200);
    const draftId = requireString(created.body, 'draftVersionId');
    world.minibusDraftId = draftId;

    const packed = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.studentId],
        },
        {
          stopId: world.adaStopId,
          kind: 'PICKUP',
          seq: 2,
          studentIds: [world.adaStudentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 3,
          studentIds: [],
        },
      ],
    });
    expect(packed.status).toBe(200);

    const overCapacity = await asUser(
      'POST',
      `/v1/admin/route-versions/${draftId}/publish`,
      admin,
    );
    expect(overCapacity.status).toBe(400);
    expect(overCapacity.body['error']).toBe('capacity_exceeded');

    const stealEfe = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.studentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 2,
          studentIds: [],
        },
      ],
    });
    expect(stealEfe.status).toBe(200);
    const doubleBook = await asUser('POST', `/v1/admin/route-versions/${draftId}/publish`, admin);
    expect(doubleBook.status).toBe(409);
    expect(doubleBook.body['error']).toBe('student_already_on_route');

    const stealAda = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.adaStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.adaStudentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 2,
          studentIds: [],
        },
      ],
    });
    expect(stealAda.status).toBe(200);
    const adaTaken = await asUser('POST', `/v1/admin/route-versions/${draftId}/publish`, admin);
    expect(adaTaken.status).toBe(409);
    expect(adaTaken.body['error']).toBe('student_already_on_route');

    const secondSchool = await asUser('POST', '/v1/admin/schools', admin, {
      name: 'Moda Ortaokulu',
      level: 'SECONDARY',
      addressId: world.schoolAddressId,
    });
    expect(secondSchool.status).toBe(200);
    world.secondSchoolId = requireString(secondSchool.body, 'id');

    const mert = await asUser('POST', '/v1/admin/students', admin, {
      fullName: 'Mert Kaya',
      schoolId: world.secondSchoolId,
      grade: '5-A',
      handoverPolicy: 'GUARDIAN_REQUIRED',
      enrollmentStart: '2026-09-01',
      pickupAddressId: world.homeAddressId,
      dropoffAddressId: world.homeAddressId,
    });
    expect(mert.status).toBe(200);
    world.mertStudentId = requireString(mert.body, 'id');

    const wrongSchool = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.mertStudentId],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 2,
          studentIds: [],
        },
      ],
    });
    expect(wrongSchool.status).toBe(400);
    expect(wrongSchool.body['error']).toBe('student_wrong_school');
  });

  it('rota API uç durumları ve sahte referansları reddeder', async () => {
    const admin = await selinAdmin();
    const ghost = randomUUID();

    const badRouteId = await asUser('GET', '/v1/admin/routes/not-a-uuid', admin);
    expect(badRouteId.status).toBe(400);
    expect(badRouteId.body['error']).toBe('invalid_body');

    const missingRoute = await asUser('GET', `/v1/admin/routes/${ghost}`, admin);
    expect(missingRoute.status).toBe(404);

    const missingVersion = await asUser('GET', `/v1/admin/route-versions/${ghost}`, admin);
    expect(missingVersion.status).toBe(404);

    const emptyStops = await asUser(
      'PUT',
      `/v1/admin/route-versions/${world.minibusDraftId}/stops`,
      admin,
      { stops: [] },
    );
    expect(emptyStops.status).toBe(400);
    expect(emptyStops.body['error']).toBe('invalid_body');

    const ghostStop = await asUser(
      'PUT',
      `/v1/admin/route-versions/${world.minibusDraftId}/stops`,
      admin,
      {
        stops: [
          { stopId: ghost, kind: 'PICKUP', seq: 1, studentIds: [world.canStudentId] },
          { stopId: world.schoolStopId, kind: 'SCHOOL', seq: 2, studentIds: [] },
        ],
      },
    );
    expect(ghostStop.status).toBe(400);
    expect(ghostStop.body['error']).toBe('invalid_reference');

    const ghostStudent = await asUser(
      'PUT',
      `/v1/admin/route-versions/${world.minibusDraftId}/stops`,
      admin,
      {
        stops: [
          { stopId: world.canStopId, kind: 'PICKUP', seq: 1, studentIds: [ghost] },
          { stopId: world.schoolStopId, kind: 'SCHOOL', seq: 2, studentIds: [] },
        ],
      },
    );
    expect(ghostStudent.status).toBe(400);
    expect(ghostStudent.body['error']).toBe('invalid_reference');

    const sameStudentTwice = await asUser(
      'PUT',
      `/v1/admin/route-versions/${world.minibusDraftId}/stops`,
      admin,
      {
        stops: [
          {
            stopId: world.canStopId,
            kind: 'PICKUP',
            seq: 1,
            studentIds: [world.canStudentId, world.canStudentId],
          },
          { stopId: world.schoolStopId, kind: 'SCHOOL', seq: 2, studentIds: [] },
        ],
      },
    );
    expect(sameStudentTwice.status).toBe(400);
    expect(sameStudentTwice.body['error']).toBe('duplicate_student');

    const twoSchools = await asUser(
      'PUT',
      `/v1/admin/route-versions/${world.minibusDraftId}/stops`,
      admin,
      {
        stops: [
          { stopId: world.schoolStopId, kind: 'SCHOOL', seq: 1, studentIds: [] },
          { stopId: world.canStopId, kind: 'SCHOOL', seq: 2, studentIds: [] },
        ],
      },
    );
    expect(twoSchools.status).toBe(200);
    const suggestTwoSchools = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.minibusDraftId}/suggest-order`,
      admin,
    );
    expect(suggestTwoSchools.status).toBe(400);
    expect(suggestTwoSchools.body['error']).toBe('multiple_school_stops');

    const emptyPassenger = await asUser(
      'PUT',
      `/v1/admin/route-versions/${world.minibusDraftId}/stops`,
      admin,
      {
        stops: [
          { stopId: world.canStopId, kind: 'PICKUP', seq: 1, studentIds: [] },
          { stopId: world.schoolStopId, kind: 'SCHOOL', seq: 2, studentIds: [] },
        ],
      },
    );
    expect(emptyPassenger.status).toBe(200);
    const suggestEmptyPassenger = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.minibusDraftId}/suggest-order`,
      admin,
    );
    expect(suggestEmptyPassenger.status).toBe(400);
    expect(suggestEmptyPassenger.body['error']).toBe('passenger_stop_empty');
    const publishEmptyPassenger = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.minibusDraftId}/publish`,
      admin,
    );
    expect(publishEmptyPassenger.status).toBe(400);
    expect(publishEmptyPassenger.body['error']).toBe('passenger_stop_empty');

    const ghostAddress = await asUser('POST', '/v1/admin/stops', admin, {
      addressId: ghost,
      label: 'Hayalet durak',
      lat: 40.99,
      lng: 29.03,
    });
    expect(ghostAddress.status).toBe(400);
    expect(ghostAddress.body['error']).toBe('invalid_reference');

    const ghostSchool = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: world.minibusId,
      schoolId: ghost,
      segment: 'AFTERNOON',
      shiftNo: 1,
      effectiveFrom: '2026-09-09',
    });
    expect(ghostSchool.status).toBe(400);
    expect(ghostSchool.body['error']).toBe('invalid_reference');

    const ghostVehicle = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: ghost,
      schoolId: world.schoolId,
      segment: 'AFTERNOON',
      shiftNo: 2,
      effectiveFrom: '2026-09-09',
    });
    expect(ghostVehicle.status).toBe(400);
    expect(ghostVehicle.body['error']).toBe('invalid_reference');

    const badLat = await asUser('POST', '/v1/admin/stops', admin, {
      addressId: world.homeAddressId,
      label: 'Kutup',
      lat: 91,
      lng: 29.03,
    });
    expect(badLat.status).toBe(400);
    expect(badLat.body['error']).toBe('invalid_body');

    const badShift = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: world.minibusId,
      schoolId: world.schoolId,
      segment: 'MORNING',
      shiftNo: 0,
      effectiveFrom: '2026-09-09',
    });
    expect(badShift.status).toBe(400);
    expect(badShift.body['error']).toBe('invalid_body');

    const missingDate = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: world.minibusId,
      schoolId: world.schoolId,
      segment: 'AFTERNOON',
      shiftNo: 2,
    });
    expect(missingDate.status).toBe(400);
    expect(missingDate.body['error']).toBe('invalid_body');

    const fromOtherRoute = await asUser(
      'POST',
      `/v1/admin/routes/${world.routeId}/versions`,
      admin,
      { fromVersionId: world.afternoonRouteId },
    );
    expect(fromOtherRoute.status).toBe(404);

    const cloneNoBody = await asUser(
      'POST',
      `/v1/admin/routes/${world.routeId}/versions`,
      admin,
    );
    expect(cloneNoBody.status).toBe(200);
    const leftover = requireString(cloneNoBody.body, 'id');
    const restored = await asUser('PUT', `/v1/admin/route-versions/${leftover}/stops`, admin, {
      stops: [
        {
          stopId: world.homeStopId,
          kind: 'PICKUP',
          seq: 1,
          studentIds: [world.studentId, world.adaStudentId],
        },
        { stopId: world.schoolStopId, kind: 'SCHOOL', seq: 2, studentIds: [] },
      ],
    });
    expect(restored.status).toBe(200);
    const republish = await asUser('POST', `/v1/admin/route-versions/${leftover}/publish`, admin);
    expect(republish.status).toBe(200);
    world.publishedVersionId = requireString(republish.body, 'id');

    const afternoonPickup = await asUser(
      'POST',
      `/v1/admin/routes/${world.afternoonRouteId}/versions`,
      admin,
      {},
    );
    expect(afternoonPickup.status).toBe(200);
    const afternoonDraft = requireString(afternoonPickup.body, 'id');
    const mixed = await asUser('PUT', `/v1/admin/route-versions/${afternoonDraft}/stops`, admin, {
      stops: [
        { stopId: world.schoolStopId, kind: 'SCHOOL', seq: 1, studentIds: [] },
        {
          stopId: world.canStopId,
          kind: 'PICKUP',
          seq: 2,
          studentIds: [world.canStudentId],
        },
      ],
    });
    expect(mixed.status).toBe(200);
    const suggestPickupPm = await asUser(
      'POST',
      `/v1/admin/route-versions/${afternoonDraft}/suggest-order`,
      admin,
    );
    expect(suggestPickupPm.status).toBe(400);
    expect(suggestPickupPm.body['error']).toBe('wrong_stop_kind');
    const restoreAfternoon = await asUser(
      'PUT',
      `/v1/admin/route-versions/${afternoonDraft}/stops`,
      admin,
      {
        stops: [
          { stopId: world.schoolStopId, kind: 'SCHOOL', seq: 1, studentIds: [] },
          {
            stopId: world.canStopId,
            kind: 'DROPOFF',
            seq: 2,
            studentIds: [world.canStudentId],
          },
          {
            stopId: world.homeStopId,
            kind: 'DROPOFF',
            seq: 3,
            studentIds: [world.studentId],
          },
          {
            stopId: world.adaStopId,
            kind: 'DROPOFF',
            seq: 4,
            studentIds: [world.adaStudentId],
          },
        ],
      },
    );
    expect(restoreAfternoon.status).toBe(200);
    const publishAfternoon = await asUser(
      'POST',
      `/v1/admin/route-versions/${afternoonDraft}/publish`,
      admin,
    );
    expect(publishAfternoon.status).toBe(200);
  });

  it('Hasan personel uygulamasını ilk kez açar; davet ACTIVE olur', async () => {
    const token = await mint({
      sub: world.hasanAuthId,
      phone: GUNES.driver.phone,
      email: GUNES.driver.email,
    });
    const session = await asUser('GET', '/v1/session', { token, client: 'crew' });
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ fullName: GUNES.driver.fullName });
    expectMembership(session.body, {
      membershipId: world.driverMembershipId,
      status: 'ACTIVE',
      role: 'DRIVER',
    });

    const [status] = await postgres.sql<{ status: string }[]>`
      select status::text from tenant_membership where id = ${world.driverMembershipId}::uuid
    `;
    expect(status?.status).toBe('ACTIVE');

    const stealAdmin = await asUser(
      'POST',
      '/v1/admin/schools',
      {
        token,
        client: 'admin',
        tenantId: world.gunes.tenantId,
      },
      {
        name: 'Kaçak Okul',
        level: 'PRIMARY',
        addressId: world.schoolAddressId,
      },
    );
    expect(stealAdmin.status).toBe(403);

    const stealRoutes = await asUser('GET', '/v1/admin/routes', {
      token,
      client: 'admin',
      tenantId: world.gunes.tenantId,
    });
    expect(stealRoutes.status).toBe(403);

    const stealPublish = await asUser(
      'POST',
      `/v1/admin/route-versions/${world.publishedVersionId}/publish`,
      {
        token,
        client: 'admin',
        tenantId: world.gunes.tenantId,
      },
    );
    expect(stealPublish.status).toBe(403);
  });

  it('Ayşe veli uygulamasını açar; yönetim paneline giremez', async () => {
    const token = await mint({ sub: world.ayseAuthId, phone: GUNES.guardian.phone });
    const session = await asUser('GET', '/v1/session', { token, client: 'parent' });
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ fullName: GUNES.guardian.fullName });
    expectMembership(session.body, {
      membershipId: world.guardianMembershipId,
      status: 'ACTIVE',
      role: 'GUARDIAN',
    });

    const forbidden = await asUser('GET', '/v1/admin/students', {
      token,
      client: 'admin',
      tenantId: world.gunes.tenantId,
    });
    expect(forbidden.status).toBe(403);

    const forbiddenRoutes = await asUser('GET', '/v1/admin/routes', {
      token,
      client: 'admin',
      tenantId: world.gunes.tenantId,
    });
    expect(forbiddenRoutes.status).toBe(403);
  });

  it('Deniz Mavi Vadi kaydını görür; Güneş verisine karışamaz', async () => {
    const denizToken = await mint({
      sub: world.denizAuthId,
      phone: MAVI.admin.phone,
      email: MAVI.admin.email,
    });
    const mavi = { token: denizToken, client: 'admin' as const, tenantId: world.mavi.tenantId };

    const session = await asUser('GET', '/v1/session', { token: denizToken, client: 'admin' });
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ fullName: MAVI.admin.fullName });

    const emptySchools = await asUser('GET', '/v1/admin/schools', mavi);
    expect(emptySchools.status).toBe(200);
    expect(requireItems(emptySchools.body)).toHaveLength(0);

    const addr = await asUser('POST', '/v1/admin/addresses', mavi, {
      text: 'Çankaya Mah. 7. Cad. No:3',
      il: 'Ankara',
      ilce: 'Çankaya',
      lat: 39.9101,
      lng: 32.8542,
    });
    expect(addr.status).toBe(200);
    const maviAddressId = requireString(addr.body, 'id');

    const school = await asUser('POST', '/v1/admin/schools', mavi, {
      name: 'Mavi Vadi Koleji',
      level: 'SECONDARY',
      addressId: maviAddressId,
    });
    expect(school.status).toBe(200);
    world.maviSchoolId = requireString(school.body, 'id');

    const maviStop = await asUser('POST', '/v1/admin/stops', mavi, {
      addressId: maviAddressId,
      label: 'Mavi Vadi kapı',
      lat: 39.9102,
      lng: 32.8543,
    });
    expect(maviStop.status).toBe(200);
    world.maviStopId = requireString(maviStop.body, 'id');

    const vehicle = await asUser('POST', '/v1/admin/vehicles', mavi, {
      plate: '06 MVD 09',
      seatCount: 14,
    });
    expect(vehicle.status).toBe(200);
    world.maviVehicleId = requireString(vehicle.body, 'id');

    const selinToken = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const stealMaviAddress = await asUser(
      'POST',
      '/v1/admin/stops',
      { token: selinToken, client: 'admin', tenantId: world.gunes.tenantId },
      {
        addressId: maviAddressId,
        label: 'Kaçak durak',
        lat: 39.91,
        lng: 32.85,
      },
    );
    expect(stealMaviAddress.status).toBe(400);
    expect(stealMaviAddress.body['error']).toBe('invalid_reference');

    const gunesSchools = await asUser('GET', '/v1/admin/schools', {
      token: selinToken,
      client: 'admin',
      tenantId: world.gunes.tenantId,
    });
    expect(new Set(requireItems(gunesSchools.body).map((row) => row['name']))).toEqual(
      new Set(['Güneş İlkokulu', 'Moda Ortaokulu']),
    );

    const crossTenant = await asUser('GET', '/v1/admin/schools', {
      token: selinToken,
      client: 'admin',
      tenantId: world.mavi.tenantId,
    });
    expect(crossTenant.status).toBe(403);

    const stolenVehicle = await asUser(
      'POST',
      '/v1/admin/staff',
      { token: selinToken, client: 'admin', tenantId: world.gunes.tenantId },
      {
        fullName: 'Kaçak Şoför',
        phone: '+905321110077',
        email: 'kacak@gunesis.net',
        role: 'DRIVER',
        vehicleId: world.maviVehicleId,
      },
    );
    expect(stolenVehicle.status).toBe(400);
    expect(stolenVehicle.body['error']).toBe('invalid_reference');

    const emptyRoutes = await asUser('GET', '/v1/admin/routes', mavi);
    expect(emptyRoutes.status).toBe(200);
    expect(requireItems(emptyRoutes.body)).toHaveLength(0);

    const maviStops = await asUser('GET', '/v1/admin/stops', mavi);
    expect(maviStops.status).toBe(200);
    expect(requireItems(maviStops.body).map((row) => row['id'])).toEqual([world.maviStopId]);

    const gunesStops = await asUser('GET', '/v1/admin/stops', {
      token: selinToken,
      client: 'admin',
      tenantId: world.gunes.tenantId,
    });
    expect(gunesStops.status).toBe(200);
    const gunesStopIds = requireItems(gunesStops.body).map((row) => row['id']);
    expect(gunesStopIds).toEqual(
      expect.arrayContaining([world.schoolStopId, world.homeStopId, world.adaStopId, world.canStopId]),
    );
    expect(gunesStopIds).not.toContain(world.maviStopId);

    const peekRoute = await asUser('GET', `/v1/admin/routes/${world.routeId}`, mavi);
    expect(peekRoute.status).toBe(404);

    const peekVersion = await asUser(
      'GET',
      `/v1/admin/route-versions/${world.publishedVersionId}`,
      mavi,
    );
    expect(peekVersion.status).toBe(404);

    const stealGunesVehicle = await asUser('POST', '/v1/admin/routes', mavi, {
      vehicleId: world.vehicleId,
      schoolId: world.maviSchoolId,
      segment: 'MORNING',
      shiftNo: 1,
      effectiveFrom: '2026-09-09',
    });
    expect(stealGunesVehicle.status).toBe(400);
    expect(stealGunesVehicle.body['error']).toBe('invalid_reference');

    const selinAdmin = {
      token: selinToken,
      client: 'admin' as const,
      tenantId: world.gunes.tenantId,
    };
    const gunesDraft = await asUser(
      'POST',
      `/v1/admin/routes/${world.routeId}/versions`,
      selinAdmin,
      {},
    );
    expect(gunesDraft.status).toBe(200);
    const isolationDraftId = requireString(gunesDraft.body, 'id');

    const stolenStop = await asUser(
      'PUT',
      `/v1/admin/route-versions/${isolationDraftId}/stops`,
      selinAdmin,
      {
        stops: [
          {
            stopId: world.maviStopId,
            kind: 'PICKUP',
            seq: 1,
            studentIds: [world.studentId],
          },
          {
            stopId: world.schoolStopId,
            kind: 'SCHOOL',
            seq: 2,
            studentIds: [],
          },
        ],
      },
    );
    expect(stolenStop.status).toBe(400);
    expect(stolenStop.body['error']).toBe('invalid_reference');

    const denizEditsGunes = await asUser(
      'PUT',
      `/v1/admin/route-versions/${isolationDraftId}/stops`,
      mavi,
      {
        stops: [
          {
            stopId: world.homeStopId,
            kind: 'PICKUP',
            seq: 1,
            studentIds: [world.studentId],
          },
          {
            stopId: world.schoolStopId,
            kind: 'SCHOOL',
            seq: 2,
            studentIds: [],
          },
        ],
      },
    );
    expect(denizEditsGunes.status).toBe(404);
  });

  it('kötü niyetli ve hatalı istekler ürün kurallarını çiğneyemez', async () => {
    const selinToken = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });

    const noClient = await request('GET', '/v1/session', {
      authorization: `Bearer ${selinToken}`,
    });
    expect(noClient.status).toBe(400);
    expect(noClient.body['error']).toBe('client_required');

    const noAuth = await request('GET', '/v1/session', { 'x-client': 'admin' });
    expect(noAuth.status).toBe(401);

    const serviceRole = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      extra: { role: 'service_role' },
    });
    const asService = await asUser('GET', '/v1/session', { token: serviceRole, client: 'admin' });
    expect(asService.status).toBe(401);

    const stranger = await mint({ sub: randomUUID(), phone: '+905399999991' });
    const unknown = await asUser('GET', '/v1/session', { token: stranger, client: 'admin' });
    expect(unknown.status).toBe(403);
    expect(unknown.body['error']).toBe('identity_not_provisioned');

    const hijack = await mint({ sub: randomUUID(), phone: GUNES.admin.phone });
    const mismatch = await asUser('GET', '/v1/session', { token: hijack, client: 'admin' });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body['error']).toBe('identity_auth_mismatch');

    const emptyTenant = await asUser('GET', '/v1/admin/schools', {
      token: selinToken,
      client: 'admin',
      extraHeaders: { 'x-tenant-id': '' },
    });
    expect(emptyTenant.status).toBe(400);

    const shortName = await asUser(
      'POST',
      '/v1/admin/schools',
      { token: selinToken, client: 'admin', tenantId: world.gunes.tenantId },
      { name: 'A', level: 'PRIMARY', addressId: world.schoolAddressId },
    );
    expect(shortName.status).toBe(400);
    expect(shortName.body['error']).toBe('invalid_body');

    const missing = await asUser('GET', '/v1/admin/does-not-exist', {
      token: selinToken,
      client: 'admin',
      tenantId: world.gunes.tenantId,
    });
    expect(missing.status).toBe(404);
    expect(missing.body['error']).toBe('not_found');
  });

  it('admin paneli CORS ile konuşur; yabancı origin konuşamaz', async () => {
    const allowed = await request('OPTIONS', '/v1/session', {
      origin: 'http://127.0.0.1:3001',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,x-client,x-tenant-id',
    });
    expect(allowed.status).toBe(204);
    expect(allowed.header('access-control-allow-origin')).toBe('http://127.0.0.1:3001');

    const selinToken = await mint({
      sub: world.selinAuthId,
      phone: GUNES.admin.phone,
      email: GUNES.admin.email,
    });
    const getAllowed = await asUser('GET', '/v1/session', {
      token: selinToken,
      client: 'admin',
      extraHeaders: { origin: 'http://localhost:3001' },
    });
    expect(getAllowed.status).toBe(200);
    expect(getAllowed.header('access-control-allow-origin')).toBe('http://localhost:3001');

    const blocked = await asUser('GET', '/v1/session', {
      token: selinToken,
      client: 'admin',
      extraHeaders: { origin: 'https://evil.example' },
    });
    expect(blocked.status).toBe(200);
    expect(blocked.header('access-control-allow-origin')).toBeUndefined();
  });

  it('eski personel APK 426 alır; politika geri alınır', async () => {
    await postgres.sql`update platform_settings set min_supported_app_version = '1.2.0'`;
    try {
      const outdated = await request('GET', '/v1/config', {
        'x-client': 'crew',
        'x-app-version': '1.0.0',
      });
      expect(outdated.status).toBe(426);
      expect(outdated.body['error']).toBe('upgrade_required');

      const current = await request('GET', '/v1/config', {
        'x-client': 'crew',
        'x-app-version': '1.2.0',
      });
      expect(current.status).toBe(200);
    } finally {
      await postgres.sql`update platform_settings set min_supported_app_version = '0.0.0'`;
    }
  });

  it('worker partition açar; API rolü açamaz ve tenant GUC olmadan okul okuyamaz', async () => {
    await workerSql`select ensure_month_partitions()`;
    const [partition] = await postgres.sql<{ relname: string | null }[]>`
      select to_regclass(
        'public.event_' || to_char(date_trunc('month', now()), 'YYYY_MM')
      )::text as relname
    `;
    expect(partition?.relname).toMatch(/^event_\d{4}_\d{2}$/);

    await expect(apiSql`select ensure_month_partitions()`).rejects.toThrow(/permission denied/);
    await expect(apiSql`select id from school`).rejects.toThrow(/app\.tenant_id is not set/);
  });

  it('hostes de ilk girişte bağlanır', async () => {
    const token = await mint({
      sub: world.elifAuthId,
      phone: GUNES.attendant.phone,
      email: GUNES.attendant.email,
    });
    const session = await asUser('GET', '/v1/session', { token, client: 'crew', version: '1.4.2' });
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ fullName: GUNES.attendant.fullName });
    expectMembership(session.body, {
      status: 'ACTIVE',
      role: 'ATTENDANT',
    });
  });
});
