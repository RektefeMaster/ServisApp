import { randomUUID } from 'node:crypto';
import { applyMigrations, createDbFromSql, createSql } from '@servisapp/db';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createPostgresData } from '../data/postgres.js';
import type { AppData } from '../data/ports.js';
import type { Env } from '../env.js';
import { runTripHorizonJob } from '../jobs/horizon.js';
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
  DEV_LOGIN_PASSWORD: 'e2e-dev-login-parola1',
  GOOGLE_MAPS_API_KEY: undefined,
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
  attendantMembershipId: string;
  guardianMembershipId: string;
  adaGuardianMembershipId: string;
  canGuardianMembershipId: string;
  hasanDevice: string;
  elifDevice: string;
  morningTripId: string;
  afternoonTripId: string;
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
  sep15MorningTripId: string;
  sep15AfternoonTripId: string;
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

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
    ...(input.phone ? { phone: input.phone, phone_verified: true } : {}),
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

describe('Kadıköy Güneş Işığı — ilk kurulum günü', { timeout: 300_000 }, () => {
  let postgres: E2ePostgres;
  let apiSql: ReturnType<typeof createSql>;
  let workerSql: ReturnType<typeof createSql>;
  let app: FastifyInstance;
  let data: AppData;
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
    headers['x-app-version'] = actor.version ?? '1.4.2';
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

  function crewActor(
    token: string,
    device: string,
    platform: 'IOS' | 'ANDROID' = 'ANDROID',
  ): {
    token: string;
    client: 'crew';
    tenantId: string;
    extraHeaders: Record<string, string>;
  } {
    return {
      token,
      client: 'crew',
      tenantId: world.gunes.tenantId,
      extraHeaders: { 'x-device-id': device, 'x-device-platform': platform },
    };
  }

  async function hasanCrew() {
    return crewActor(
      await mint({
        sub: world.hasanAuthId,
        phone: GUNES.driver.phone,
        email: GUNES.driver.email,
      }),
      world.hasanDevice,
    );
  }

  async function elifCrew() {
    return crewActor(
      await mint({
        sub: world.elifAuthId,
        phone: GUNES.attendant.phone,
        email: GUNES.attendant.email,
      }),
      world.elifDevice,
      'IOS',
    );
  }

  async function command(
    actor: Awaited<ReturnType<typeof hasanCrew>>,
    tripId: string,
    input: {
      tripStudentId: string;
      action:
        | 'BOARD'
        | 'MARK_NO_SHOW'
        | 'DELIVER'
        | 'MARK_DELIVERY_FAILED'
        | 'RETURN_HOME'
        | 'RESOLVE_DELIVERED_LATE'
        | 'RESOLVE_RETURNED_TO_SCHOOL'
        | 'RESOLVE_HANDED_TO_ADMIN';
      expectedStateSeq: number;
      clientEventId?: string;
      receiverMembershipId?: string;
    },
  ) {
    return asUser('POST', `/v1/trips/${tripId}/commands`, actor, {
      clientEventId: input.clientEventId ?? randomUUID(),
      tripStudentId: input.tripStudentId,
      action: input.action,
      expectedStateSeq: input.expectedStateSeq,
      ...(input.receiverMembershipId
        ? { receiverMembershipId: input.receiverMembershipId }
        : {}),
    });
  }

  async function ayseParent() {
    return {
      token: await mint({ sub: world.ayseAuthId, phone: GUNES.guardian.phone }),
      client: 'parent' as const,
      tenantId: world.gunes.tenantId,
    };
  }

  async function pingLocation(
    actor: Awaited<ReturnType<typeof hasanCrew>>,
    tripId: string,
    input: {
      lat: number;
      lng: number;
      sessionEpoch: number;
      accuracyM?: number;
      speedMps?: number;
      recordedAt?: string;
    },
  ) {
    return asUser('POST', `/v1/trips/${tripId}/location`, actor, {
      lat: input.lat,
      lng: input.lng,
      accuracyM: input.accuracyM ?? 10,
      speedMps: input.speedMps ?? 6,
      heading: 80,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
      sessionEpoch: input.sessionEpoch,
    });
  }

  async function startActiveTrip(actor: Awaited<ReturnType<typeof hasanCrew>>, tripId: string) {
    const before = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, actor, {
      phase: 'BEFORE',
      vehicleEmptyConfirmed: true,
    });
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    const started = await asUser('POST', `/v1/trips/${tripId}/start`, actor);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body['state']).toBe('ACTIVE');
    return started;
  }

  function assertNoOtpSecret(body: Record<string, unknown>): void {
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/otp_hmac|otp_ciphertext|"otpCode"|otp_code/i);
  }

  function expectError(
    response: { status: number; body: Record<string, unknown> },
    status: number,
    error: string,
  ): void {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(response.body['error']).toBe(error);
  }

  function tripByRoute(items: Record<string, unknown>[], routeId: string): Record<string, unknown> {
    const row = items.find((item) => item['routeId'] === routeId);
    if (!row) throw new Error(`rota seferi yok: ${routeId}`);
    return row;
  }

  function studentRow(students: unknown, studentId: string): Record<string, unknown> {
    if (!Array.isArray(students)) throw new Error('öğrenciler yok');
    const row = students.filter(isRecord).find((item) => item['studentId'] === studentId);
    if (!row) throw new Error(`öğrenci seferde yok: ${studentId}`);
    return row;
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
      attendantMembershipId: '',
      guardianMembershipId: '',
      adaGuardianMembershipId: '',
      canGuardianMembershipId: '',
      hasanDevice: '',
      elifDevice: '',
      morningTripId: '',
      afternoonTripId: '',
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
      sep15MorningTripId: '',
      sep15AfternoonTripId: '',
    };
    data = createPostgresData(apiSql, {
      invitePepper: env.OTP_PEPPER,
      otpEncryptionKey: env.OTP_ENCRYPTION_KEY,
      publicAppUrl: 'http://127.0.0.1:3001',
      revealInviteSecrets: true,
    });
    app = buildApp({
      env,
      data,
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
      validFrom: '2026-09-01',
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
      validFrom: '2026-09-01',
    });
    expect(attendant.status).toBe(200);
    world.attendantMembershipId = requireString(attendant.body, 'membershipId');

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

    const adaGuardian = await asUser(
      'POST',
      `/v1/admin/students/${world.adaStudentId}/guardians`,
      admin,
      {
        fullName: 'Zeynep Demir',
        phone: '+905321110071',
        relation: 'Anne',
        isPrimary: true,
        canReceiveChild: true,
        canAuthorizeTempAddress: true,
        canSubmitException: true,
        notifyAm: true,
        notifyPm: true,
      },
    );
    expect(adaGuardian.status).toBe(200);
    world.adaGuardianMembershipId = requireString(adaGuardian.body, 'membershipId');

    const canGuardian = await asUser(
      'POST',
      `/v1/admin/students/${world.canStudentId}/guardians`,
      admin,
      {
        fullName: 'Mehmet Yılmaz',
        phone: '+905321110072',
        relation: 'Baba',
        isPrimary: true,
        canReceiveChild: true,
        canAuthorizeTempAddress: true,
        canSubmitException: true,
        notifyAm: true,
        notifyPm: true,
      },
    );
    expect(canGuardian.status).toBe(200);
    world.canGuardianMembershipId = requireString(canGuardian.body, 'membershipId');

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

    const fromArchived = await asUser('POST', `/v1/admin/routes/${world.routeId}/versions`, admin, {
      fromVersionId: world.draftVersionId,
    });
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

    const overCapacity = await asUser('POST', `/v1/admin/route-versions/${draftId}/publish`, admin);
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

    const cloneNoBody = await asUser('POST', `/v1/admin/routes/${world.routeId}/versions`, admin);
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
    expectError(session, 403, 'identity_not_provisioned');

    const blockedChildren = await asUser('GET', '/v1/parent/children', {
      token,
      client: 'parent',
      tenantId: world.gunes.tenantId,
    });
    expect(blockedChildren.status).toBe(403);

    const admin = await selinAdmin();
    const invite = await asUser('POST', '/v1/admin/invites', admin, {
      membershipId: world.guardianMembershipId,
    });
    expect(invite.status).toBe(200);
    const inviteToken = requireString(invite.body, 'token');
    const activated = await asUser(
      'POST',
      '/v1/parent/invites/activate',
      { token, client: 'parent' },
      {
        token: inviteToken,
      },
    );
    expect(activated.status).toBe(200);

    const after = await asUser('GET', '/v1/session', { token, client: 'parent' });
    expectMembership(after.body, {
      membershipId: world.guardianMembershipId,
      status: 'ACTIVE',
      role: 'GUARDIAN',
    });

    const children = await asUser('GET', '/v1/parent/children', {
      token,
      client: 'parent',
      tenantId: world.gunes.tenantId,
    });
    expect(children.status).toBe(200);
    expect(requireItems(children.body).some((item) => item['studentId'] === world.studentId)).toBe(
      true,
    );

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
      expect.arrayContaining([
        world.schoolStopId,
        world.homeStopId,
        world.adaStopId,
        world.canStopId,
      ]),
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

    const noAuth = await request('GET', '/v1/session', {
      'x-client': 'admin',
      'x-app-version': '1.4.2',
    });
    expect(noAuth.status).toBe(401);

    const noVersion = await request('GET', '/v1/session', { 'x-client': 'admin' });
    expect(noVersion.status).toBe(400);
    expect(noVersion.body['error']).toBe('app_version_required');

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

    const emailThief = await mint({ sub: randomUUID(), email: GUNES.driver.email });
    const stolen = await asUser('GET', '/v1/session', { token: emailThief, client: 'crew' });
    expect(stolen.status).toBe(403);
    expect(stolen.body['error']).toBe('identity_not_provisioned');

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

  it('yayınlı rotadan 7 günlük ufuk sefer üretir; tatil ve ikinci üretim atlanır', async () => {
    const admin = await selinAdmin();
    const holiday = await asUser(
      'POST',
      `/v1/admin/schools/${world.schoolId}/calendar-days`,
      admin,
      { date: '2026-09-11', type: 'HOLIDAY' },
    );
    expect(holiday.status).toBe(200);

    const holidayAgain = await asUser(
      'POST',
      `/v1/admin/schools/${world.schoolId}/calendar-days`,
      admin,
      { date: '2026-09-11', type: 'HOLIDAY' },
    );
    expect(holidayAgain.status).toBe(200);

    const maviHoliday = await asUser(
      'POST',
      `/v1/admin/schools/${world.schoolId}/calendar-days`,
      {
        token: await mint({
          sub: world.denizAuthId,
          phone: MAVI.admin.phone,
          email: MAVI.admin.email,
        }),
        client: 'admin',
        tenantId: world.mavi.tenantId,
      },
      { date: '2026-09-11', type: 'HOLIDAY' },
    );
    expectError(maviHoliday, 404, 'not_found');

    const tooManyDays = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-10',
      days: 15,
    });
    expectError(tooManyDays, 400, 'invalid_body');

    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-10',
      days: 2,
    });
    expect(generated.status).toBe(200);
    expect(generated.body['created']).toBe(2);
    const firstIds = generated.body['tripIds'];
    expect(Array.isArray(firstIds)).toBe(true);
    expect(firstIds).toHaveLength(2);

    const again = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-10',
      days: 2,
    });
    expect(again.status).toBe(200);
    expect(again.body['created']).toBe(0);
    expect(again.body['skipped']).toBeGreaterThanOrEqual(2);

    const ghostDevice = randomUUID();
    const onHoliday = await asUser('GET', '/v1/trips?date=2026-09-11', {
      ...admin,
      extraHeaders: { 'x-device-id': ghostDevice },
    });
    expect(onHoliday.status).toBe(200);
    expect(requireItems(onHoliday.body)).toHaveLength(0);
    const [bound] = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from device where id = ${ghostDevice}::uuid
    `;
    expect(bound?.n).toBe('0');

    const listed = await asUser('GET', '/v1/trips?date=2026-09-10', admin);
    expect(listed.status).toBe(200);
    const items = requireItems(listed.body);
    expect(items).toHaveLength(2);
    expect(items.every((row) => row['vehicleId'] === world.vehicleId)).toBe(true);
    const morning = tripByRoute(items, world.routeId);
    const afternoon = tripByRoute(items, world.afternoonRouteId);
    world.morningTripId = requireString(morning, 'id');
    world.afternoonTripId = requireString(afternoon, 'id');
    expect(items.every((row) => row['serviceDate'] === '2026-09-10')).toBe(true);
    expect(items.every((row) => row['state'] === 'PLANNED')).toBe(true);
    expect(morning['segment']).toBe('MORNING');
    expect(afternoon['segment']).toBe('AFTERNOON');
    expect(morning['plate']).toBe('34 GNS 142');
    expect(morning['schoolName']).toBe('Güneş İlkokulu');
  });

  it('Hasan sabah seferini araç boş, bindi/binmedi ve kapanış invariantlarıyla yürütür', async () => {
    const hasanToken = await mint({
      sub: world.hasanAuthId,
      phone: GUNES.driver.phone,
      email: GUNES.driver.email,
    });
    world.hasanDevice = randomUUID();
    const hasan = crewActor(hasanToken, world.hasanDevice);
    const hasanBare = {
      token: hasanToken,
      client: 'crew' as const,
      tenantId: world.gunes.tenantId,
    };

    const ayseToken = await mint({
      sub: world.ayseAuthId,
      phone: GUNES.guardian.phone,
    });
    const parentList = await asUser('GET', '/v1/trips?date=2026-09-10', {
      token: ayseToken,
      client: 'parent',
      tenantId: world.gunes.tenantId,
    });
    expectError(parentList, 403, 'forbidden');

    const missingDate = await asUser('GET', '/v1/trips', hasan);
    expectError(missingDate, 400, 'invalid_body');

    const listedBare = await asUser('GET', '/v1/trips?date=2026-09-10', hasanBare);
    expect(listedBare.status).toBe(200);

    const listed = await asUser('GET', '/v1/trips?date=2026-09-10', hasan);
    expect(listed.status).toBe(200);
    const morning = tripByRoute(requireItems(listed.body), world.routeId);
    const tripId = requireString(morning, 'id');
    world.morningTripId = tripId;

    const detail = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(detail.status).toBe(200);
    expect(detail.body['state']).toBe('PLANNED');
    const students = detail.body['students'];
    const efe = studentRow(students, world.studentId);
    const ada = studentRow(students, world.adaStudentId);
    const efeId = requireString(efe, 'id');
    const adaId = requireString(ada, 'id');
    expect(efe['deliveryTarget']).toBe('SCHOOL');
    expect(efe['state']).toBe('EXPECTED');
    expect(efe['needsReview']).toBe(false);
    expect(efe['guardianPhone']).toBe(GUNES.guardian.phone);
    expect(efe['guardianName']).toBe(GUNES.guardian.fullName);
    expect(efe['deliveryVerified']).toBe(false);
    expect(typeof efe['expectedStopLabel']).toBe('string');
    expect(ada['guardianPhone']).toBe('+905321110071');
    expect(ada['guardianName']).toBe('Zeynep Demir');
    expect(Array.isArray(ada['receivers']) ? ada['receivers'].length : 0).toBe(1);
    expect(Array.isArray(students) ? students.length : 0).toBe(2);

    const stops = requireStops(detail.body);
    const homeSnap = stops.find((row) => Number(row['seq']) === 1);
    expect(homeSnap).toBeTruthy();
    expect(Number(homeSnap?.['lat'])).toBeCloseTo(40.9713, 5);
    await postgres.sql`
      update stop set lat = 41.5 where id = ${world.homeStopId}::uuid
    `;
    const afterEdit = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(afterEdit.status).toBe(200);
    const snapAgain = requireStops(afterEdit.body).find((row) => Number(row['seq']) === 1);
    expect(Number(snapAgain?.['lat'])).toBeCloseTo(40.9713, 5);

    const afterEarly = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'AFTER',
      vehicleEmptyConfirmed: true,
    });
    expectError(afterEarly, 409, 'trip_not_active');

    const startBare = await asUser('POST', `/v1/trips/${tripId}/start`, hasanBare);
    expectError(startBare, 400, 'device_required');

    const startBadDevice = await asUser('POST', `/v1/trips/${tripId}/start`, {
      ...hasanBare,
      extraHeaders: { 'x-device-id': 'cihaz' },
    });
    expectError(startBadDevice, 400, 'invalid_device');

    const falseCheck = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'BEFORE',
      vehicleEmptyConfirmed: false,
    });
    expectError(falseCheck, 400, 'invalid_body');

    const boardWhilePlanned = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: randomUUID(),
      tripStudentId: efeId,
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(boardWhilePlanned.status).toBe(200);
    expect(boardWhilePlanned.body).toMatchObject({
      status: 'REJECTED',
      reason: 'TRIP_NOT_IN_REQUIRED_STATE',
      state: 'EXPECTED',
    });

    const startEarly = await asUser('POST', `/v1/trips/${tripId}/start`, hasan);
    expectError(startEarly, 409, 'vehicle_sweep_not_confirmed');

    const before = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'BEFORE',
      vehicleEmptyConfirmed: true,
    });
    expect(before.status).toBe(200);
    expect(before.body['state']).toBe('READY');

    const beforeAgain = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'BEFORE',
      vehicleEmptyConfirmed: true,
    });
    expect(beforeAgain.status).toBe(200);
    expect(beforeAgain.body['state']).toBe('READY');

    const boardWhileReady = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: randomUUID(),
      tripStudentId: efeId,
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(boardWhileReady.body).toMatchObject({
      status: 'REJECTED',
      reason: 'TRIP_NOT_IN_REQUIRED_STATE',
    });

    const started = await asUser('POST', `/v1/trips/${tripId}/start`, hasan);
    expect(started.status).toBe(200);
    expect(started.body['state']).toBe('ACTIVE');
    expect(started.body['plate']).toBe('34 GNS 142');

    const shortIncident = await asUser('POST', `/v1/trips/${tripId}/incidents`, hasan, {
      body: 'ab',
    });
    expectError(shortIncident, 400, 'invalid_body');
    const incident = await asUser('POST', `/v1/trips/${tripId}/incidents`, hasan, {
      body: 'Kapıda veli yok, bekliyoruz',
      studentId: world.studentId,
    });
    expect(incident.status).toBe(200);
    const ghostStudent = await asUser('POST', `/v1/trips/${tripId}/incidents`, hasan, {
      body: 'Yanlış öğrenci',
      studentId: randomUUID(),
    });
    expectError(ghostStudent, 404, 'not_found');

    const startAgain = await asUser('POST', `/v1/trips/${tripId}/start`, hasan);
    expectError(startAgain, 409, 'illegal_transition');

    const latOnly = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: randomUUID(),
      tripStudentId: efeId,
      action: 'BOARD',
      expectedStateSeq: 0,
      lat: 40.9713,
    });
    expectError(latOnly, 400, 'invalid_body');

    const boardId = randomUUID();
    const boarded = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: boardId,
      tripStudentId: efeId,
      action: 'BOARD',
      expectedStateSeq: 0,
      lat: 40.9713,
      lng: 29.0756,
    });
    expect(boarded.status).toBe(200);
    expect(boarded.body).toMatchObject({
      status: 'APPLIED',
      replay: false,
      state: 'ON_BOARD',
      stateSeq: 1,
    });

    const replay = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: boardId,
      tripStudentId: efeId,
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replay: true, status: 'APPLIED', state: 'ON_BOARD' });

    const reused = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: boardId,
      tripStudentId: efeId,
      action: 'MARK_NO_SHOW',
      expectedStateSeq: 0,
    });
    expectError(reused, 409, 'command_id_reuse');

    const conflictBoard = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: randomUUID(),
      tripStudentId: efeId,
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(conflictBoard.status).toBe(200);
    expect(conflictBoard.body).toMatchObject({
      status: 'CONFLICT',
      reason: 'STUDENT_STATE_CONFLICT',
      state: 'ON_BOARD',
      stateSeq: 1,
    });
    const afterConflict = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(studentRow(afterConflict.body['students'], world.studentId)['needsReview']).toBe(true);

    const delivered = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: randomUUID(),
      tripStudentId: efeId,
      action: 'DELIVER',
      expectedStateSeq: 1,
    });
    expect(delivered.status).toBe(200);
    expect(delivered.body).toMatchObject({ status: 'APPLIED', state: 'DELIVERED' });

    const deliverAgain = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: randomUUID(),
      tripStudentId: efeId,
      action: 'DELIVER',
      expectedStateSeq: 2,
    });
    expect(deliverAgain.status).toBe(200);
    expect(deliverAgain.body).toMatchObject({
      status: 'REJECTED',
      reason: 'ALREADY_IN_TARGET_STATE',
    });

    const completeBlocked = await asUser('POST', `/v1/trips/${tripId}/complete`, hasan);
    expectError(completeBlocked, 409, 'students_still_on_trip');

    const noShowId = randomUUID();
    const noShow = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: noShowId,
      tripStudentId: adaId,
      action: 'MARK_NO_SHOW',
      expectedStateSeq: 0,
    });
    expect(noShow.status).toBe(200);
    expect(noShow.body).toMatchObject({ status: 'APPLIED', state: 'NO_SHOW' });

    const undoNoShow = await asUser('POST', `/v1/trips/${tripId}/commands/undo`, hasan, {
      clientEventId: randomUUID(),
      targetClientEventId: noShowId,
      tripStudentId: adaId,
    });
    expect(undoNoShow.status).toBe(200);
    expect(undoNoShow.body).toMatchObject({ status: 'APPLIED', state: 'EXPECTED' });

    const boardThenUndoId = randomUUID();
    const undoBeforeBoardId = randomUUID();
    const undoBeforeBoard = await asUser('POST', `/v1/trips/${tripId}/commands/undo`, hasan, {
      clientEventId: undoBeforeBoardId,
      targetClientEventId: boardThenUndoId,
      tripStudentId: adaId,
    });
    expect(undoBeforeBoard.status).toBe(200);
    expect(undoBeforeBoard.body).toMatchObject({ status: 'PENDING', reason: 'TARGET_NOT_APPLIED' });

    const boardAda = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: boardThenUndoId,
      tripStudentId: adaId,
      action: 'BOARD',
      expectedStateSeq: Number(undoNoShow.body['stateSeq']),
    });
    expect(boardAda.status).toBe(200);
    expect(boardAda.body).toMatchObject({ status: 'APPLIED', state: 'ON_BOARD' });

    const afterDrain = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(studentRow(afterDrain.body['students'], world.adaStudentId)['state']).toBe('EXPECTED');

    const undoReplay = await asUser('POST', `/v1/trips/${tripId}/commands/undo`, hasan, {
      clientEventId: undoBeforeBoardId,
      targetClientEventId: boardThenUndoId,
      tripStudentId: adaId,
    });
    expect(undoReplay.status).toBe(200);
    expect(undoReplay.body).toMatchObject({
      replay: true,
      status: 'APPLIED',
      state: 'EXPECTED',
    });

    const earlyUndo = await asUser('POST', `/v1/trips/${tripId}/commands/undo`, hasan, {
      clientEventId: randomUUID(),
      targetClientEventId: randomUUID(),
      tripStudentId: adaId,
    });
    expect(earlyUndo.status).toBe(200);
    expect(earlyUndo.body).toMatchObject({ status: 'PENDING', reason: 'TARGET_NOT_APPLIED' });

    const noShowAgain = await asUser('POST', `/v1/trips/${tripId}/commands`, hasan, {
      clientEventId: randomUUID(),
      tripStudentId: adaId,
      action: 'MARK_NO_SHOW',
      expectedStateSeq: Number(studentRow(afterDrain.body['students'], world.adaStudentId)['stateSeq']),
    });
    expect(noShowAgain.status).toBe(200);
    expect(noShowAgain.body).toMatchObject({ status: 'APPLIED', state: 'NO_SHOW' });

    const completeNoSweep = await asUser('POST', `/v1/trips/${tripId}/complete`, hasan);
    expectError(completeNoSweep, 409, 'vehicle_sweep_not_confirmed');

    const after = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'AFTER',
      vehicleEmptyConfirmed: true,
    });
    expect(after.status).toBe(200);

    const afterAgain = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'AFTER',
      vehicleEmptyConfirmed: true,
    });
    expect(afterAgain.status).toBe(200);
    expect(afterAgain.body['state']).toBe('ACTIVE');

    const completed = await asUser('POST', `/v1/trips/${tripId}/complete`, hasan);
    expect(completed.status).toBe(200);
    expect(completed.body['state']).toBe('COMPLETED');

    const beforeDone = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'BEFORE',
      vehicleEmptyConfirmed: true,
    });
    expectError(beforeDone, 409, 'trip_not_awaiting_start');
    const startDone = await asUser('POST', `/v1/trips/${tripId}/start`, hasan);
    expectError(startDone, 409, 'illegal_transition');
    const completeDone = await asUser('POST', `/v1/trips/${tripId}/complete`, hasan);
    expectError(completeDone, 409, 'illegal_transition');

    const [events] = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from event
      where trip_id = ${tripId}::uuid and event_type = 'TRIP_COMPLETED'
    `;
    expect(events?.n).toBe('1');
    const [homeCode] = await postgres.sql<{ delivery_method: string | null }[]>`
      select delivery_method::text from trip_student where id = ${efeId}::uuid
    `;
    expect(homeCode?.delivery_method).toBeNull();
    await expect(
      postgres.sql`update event set event_type = 'HACK' where trip_id = ${tripId}::uuid`,
    ).rejects.toThrow(/event.*is_append_only/);

    const denizToken = await mint({
      sub: world.denizAuthId,
      phone: MAVI.admin.phone,
      email: MAVI.admin.email,
    });
    const stolen = await asUser('GET', `/v1/trips/${tripId}`, {
      token: denizToken,
      client: 'admin',
      tenantId: world.mavi.tenantId,
      extraHeaders: { 'x-device-id': randomUUID() },
    });
    expect(stolen.status).toBe(404);
  });

  it('Elif akşam seferini hostes olarak kapatır; cihaz çalma ve yanlış öğrenci reddedilir', async () => {
    const admin = await selinAdmin();
    const elifToken = await mint({
      sub: world.elifAuthId,
      phone: GUNES.attendant.phone,
      email: GUNES.attendant.email,
    });
    world.elifDevice = randomUUID();
    const elif = crewActor(elifToken, world.elifDevice, 'IOS');
    const hasan = crewActor(
      await mint({
        sub: world.hasanAuthId,
        phone: GUNES.driver.phone,
        email: GUNES.driver.email,
      }),
      world.hasanDevice,
    );
    const tripId = world.afternoonTripId;

    const detail = await asUser('GET', `/v1/trips/${tripId}`, elif);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      state: 'PLANNED',
      segment: 'AFTERNOON',
      checks: { before: false, after: false },
    });
    const can = studentRow(detail.body['students'], world.canStudentId);
    const efePm = studentRow(detail.body['students'], world.studentId);
    const adaPm = studentRow(detail.body['students'], world.adaStudentId);
    expect(can['deliveryTarget']).toBe('HOME');
    expect(efePm['deliveryTarget']).toBe('HOME');
    const canId = requireString(can, 'id');
    const efePmId = requireString(efePm, 'id');
    const adaPmId = requireString(adaPm, 'id');
    const stops = requireStops(detail.body);
    expect(stops[0]?.['kind']).toBe('SCHOOL');

    const ghost = await asUser('GET', `/v1/trips/${randomUUID()}`, elif);
    expectError(ghost, 404, 'not_found');
    const badId = await asUser('GET', '/v1/trips/not-a-uuid', elif);
    expectError(badId, 400, 'invalid_body');

    const stolenDevice = await asUser(
      'POST',
      `/v1/trips/${tripId}/vehicle-checks`,
      {
        ...elif,
        extraHeaders: { 'x-device-id': world.hasanDevice, 'x-device-platform': 'IOS' },
      },
      { phase: 'BEFORE', vehicleEmptyConfirmed: true },
    );
    expectError(stolenDevice, 409, 'device_bound');

    const driverCancel = await asUser('POST', `/v1/trips/${tripId}/cancel`, hasan, {
      reason: 'Yağmur nedeniyle sefer iptal',
    });
    expectError(driverCancel, 403, 'forbidden');

    const shortCancel = await asUser('POST', `/v1/trips/${tripId}/cancel`, admin, {
      reason: 'ab',
    });
    expectError(shortCancel, 400, 'invalid_body');

    const generateAsDriver = await asUser('POST', '/v1/admin/trips/generate', hasan, {
      fromDate: '2026-09-10',
      days: 1,
    });
    expectError(generateAsDriver, 403, 'forbidden');

    await postgres.sql`
      update trip
      set current_attendant_membership_id = null
      where id = ${tripId}::uuid
    `;

    const before = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, elif, {
      phase: 'BEFORE',
      vehicleEmptyConfirmed: true,
    });
    expect(before.status).toBe(200);
    expect(before.body['state']).toBe('READY');

    const started = await asUser('POST', `/v1/trips/${tripId}/start`, elif);
    expect(started.status).toBe(200);
    expect(started.body['state']).toBe('ACTIVE');
    const [attached] = await postgres.sql<{ attendant: string | null }[]>`
      select current_attendant_membership_id::text as attendant
      from trip where id = ${tripId}::uuid
    `;
    expect(attached?.attendant).toBe(world.attendantMembershipId);

    const morningEfe = studentRow(
      (await asUser('GET', `/v1/trips/${world.morningTripId}`, hasan)).body['students'],
      world.studentId,
    );
    const crossTrip = await asUser('POST', `/v1/trips/${tripId}/commands`, elif, {
      clientEventId: randomUUID(),
      tripStudentId: requireString(morningEfe, 'id'),
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(crossTrip.status).toBe(200);
    expect(crossTrip.body).toMatchObject({
      status: 'REJECTED',
      reason: 'TRIP_MISMATCH',
      state: '',
      stateSeq: 0,
    });

    const boarded = await asUser('POST', `/v1/trips/${tripId}/commands`, elif, {
      clientEventId: randomUUID(),
      tripStudentId: canId,
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(boarded.body).toMatchObject({ status: 'APPLIED', state: 'ON_BOARD' });

    const dropped = await asUser('POST', `/v1/trips/${tripId}/commands`, elif, {
      clientEventId: randomUUID(),
      tripStudentId: canId,
      action: 'DELIVER',
      expectedStateSeq: 1,
      receiverMembershipId: world.canGuardianMembershipId,
    });
    expect(dropped.body).toMatchObject({ status: 'APPLIED', state: 'DELIVERED' });
    const [homeCode] = await postgres.sql<{ delivery_method: string | null }[]>`
      select delivery_method::text from trip_student where id = ${canId}::uuid
    `;
    expect(homeCode?.delivery_method).toBe('HOME_NO_CODE');

    for (const [id, seq] of [
      [efePmId, 0],
      [adaPmId, 0],
    ] as const) {
      const marked = await asUser('POST', `/v1/trips/${tripId}/commands`, elif, {
        clientEventId: randomUUID(),
        tripStudentId: id,
        action: 'MARK_NO_SHOW',
        expectedStateSeq: seq,
      });
      expect(marked.body).toMatchObject({ status: 'APPLIED', state: 'NO_SHOW' });
    }

    const after = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, elif, {
      phase: 'AFTER',
      vehicleEmptyConfirmed: true,
    });
    expect(after.status).toBe(200);
    const completed = await asUser('POST', `/v1/trips/${tripId}/complete`, elif);
    expect(completed.status).toBe(200);
    expect(completed.body['state']).toBe('COMPLETED');

    const [ios] = await postgres.sql<{ platform: string }[]>`
      select platform::text from device where id = ${world.elifDevice}::uuid
    `;
    expect(ios?.platform).toBe('IOS');
  });

  it('planlı devamsız ve rota taşıma üretimde öğrenci durumuna işler', async () => {
    const admin = await selinAdmin();
    await postgres.sql`
      insert into ride_exception (
        tenant_id, student_id, service_date, segment, created_by_membership_id, source
      ) values (
        ${world.gunes.tenantId}::uuid,
        ${world.studentId}::uuid,
        '2026-09-12',
        'MORNING',
        ${world.guardianMembershipId}::uuid,
        'PARENT'
      )
    `;
    await postgres.sql`
      insert into student_trip_move (
        tenant_id, student_id, service_date, segment, target_route_id, reason
      ) values (
        ${world.gunes.tenantId}::uuid,
        ${world.adaStudentId}::uuid,
        '2026-09-12',
        'MORNING',
        ${world.afternoonRouteId}::uuid,
        'Ada akşam aracına alındı'
      ), (
        ${world.gunes.tenantId}::uuid,
        ${world.canStudentId}::uuid,
        '2026-09-12',
        'MORNING',
        ${world.routeId}::uuid,
        'Can sabah rotasına alındı'
      )
    `;

    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-12',
      days: 1,
    });
    expect(generated.status).toBe(200);
    expect(generated.body['created']).toBe(2);

    const listed = await asUser('GET', '/v1/trips?date=2026-09-12', admin);
    const morningId = requireString(tripByRoute(requireItems(listed.body), world.routeId), 'id');
    const detail = await asUser('GET', `/v1/trips/${morningId}`, admin);
    expect(detail.status).toBe(200);
    expect(studentRow(detail.body['students'], world.studentId)['state']).toBe('ABSENT_PLANNED');
    expect(studentRow(detail.body['students'], world.adaStudentId)['state']).toBe('MOVED_OUT');
    expect(studentRow(detail.body['students'], world.canStudentId)['state']).toBe('EXPECTED');
    expect(studentRow(detail.body['students'], world.canStudentId)['expectedStopLabel']).toBe(
      'Demir apt. önü',
    );
    const canTripStudentId = requireString(
      studentRow(detail.body['students'], world.canStudentId),
      'id',
    );
    const hasan = crewActor(
      await mint({
        sub: world.hasanAuthId,
        phone: GUNES.driver.phone,
        email: GUNES.driver.email,
      }),
      world.hasanDevice || randomUUID(),
    );
    const before = await asUser('POST', `/v1/trips/${morningId}/vehicle-checks`, hasan, {
      phase: 'BEFORE',
      vehicleEmptyConfirmed: true,
    });
    expect(before.status).toBe(200);
    const started = await asUser('POST', `/v1/trips/${morningId}/start`, hasan);
    expect(started.status).toBe(200);
    const boarded = await asUser('POST', `/v1/trips/${morningId}/commands`, hasan, {
      clientEventId: randomUUID(),
      tripStudentId: canTripStudentId,
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(boarded.body).toMatchObject({ status: 'APPLIED', state: 'ON_BOARD' });
    const [origins] = await postgres.sql<{ can_origin: string }[]>`
      select ts.origin::text as can_origin
      from trip_student ts
      where ts.trip_id = ${morningId}::uuid and ts.student_id = ${world.canStudentId}::uuid
    `;
    expect(origins?.can_origin).toBe('MOVED_IN');
  });

  it('yönetici cihazsız planlı seferi iptal eder; şoför başlatamaz', async () => {
    const admin = await selinAdmin();
    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-13',
      days: 1,
    });
    expect(generated.status).toBe(200);
    expect(generated.body['created']).toBe(2);

    const listed = await asUser('GET', '/v1/trips?date=2026-09-13', admin);
    const tripId = requireString(tripByRoute(requireItems(listed.body), world.routeId), 'id');

    const cancelled = await asUser('POST', `/v1/trips/${tripId}/cancel`, admin, {
      reason: 'Okul gezisi nedeniyle servis yok',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body['state']).toBe('CANCELLED');

    const hasan = crewActor(
      await mint({
        sub: world.hasanAuthId,
        phone: GUNES.driver.phone,
        email: GUNES.driver.email,
      }),
      world.hasanDevice,
    );
    const visible = await asUser('GET', '/v1/trips?date=2026-09-13', hasan);
    expect(visible.status).toBe(200);
    expect(tripByRoute(requireItems(visible.body), world.routeId)['state']).toBe('CANCELLED');

    const startCrew = await asUser('POST', `/v1/trips/${tripId}/start`, hasan);
    expectError(startCrew, 409, 'illegal_transition');

    const startAdmin = await asUser('POST', `/v1/trips/${tripId}/start`, {
      ...admin,
      extraHeaders: { 'x-device-id': randomUUID(), 'x-device-platform': 'ANDROID' },
    });
    expectError(startAdmin, 409, 'illegal_transition');
    const again = await asUser('POST', `/v1/trips/${tripId}/cancel`, admin, {
      reason: 'İkinci kez iptal denemesi',
    });
    expectError(again, 409, 'illegal_transition');

    const listedDetail = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(listedDetail.status).toBe(200);
    const cancelledEfe = studentRow(listedDetail.body['students'], world.studentId);
    const afterCancel = await command(hasan, tripId, {
      tripStudentId: requireString(cancelledEfe, 'id'),
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(afterCancel.status).toBe(200);
    expect(afterCancel.body).toMatchObject({
      status: 'REJECTED',
      reason: 'TRIP_NOT_IN_REQUIRED_STATE',
    });
  });

  it('Hasan ve Elif aynı sabah seferini birlikte yürütür; sonradan binen çocuk boş onayı düşürür', async () => {
    const admin = await selinAdmin();
    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-15',
      days: 1,
    });
    expect(generated.status).toBe(200);
    expect(generated.body['created']).toBe(2);

    const listed = await asUser('GET', '/v1/trips?date=2026-09-15', admin);
    expect(listed.status).toBe(200);
    const items = requireItems(listed.body);
    world.sep15MorningTripId = requireString(tripByRoute(items, world.routeId), 'id');
    world.sep15AfternoonTripId = requireString(tripByRoute(items, world.afternoonRouteId), 'id');
    const tripId = world.sep15MorningTripId;

    const hasan = await hasanCrew();
    const elif = await elifCrew();
    const [hasanList, elifList] = await Promise.all([
      asUser('GET', '/v1/trips?date=2026-09-15', hasan),
      asUser('GET', '/v1/trips?date=2026-09-15', elif),
    ]);
    expect(hasanList.status).toBe(200);
    expect(elifList.status).toBe(200);
    expect(tripByRoute(requireItems(hasanList.body), world.routeId)['id']).toBe(tripId);
    expect(tripByRoute(requireItems(elifList.body), world.routeId)['id']).toBe(tripId);

    const ayseToken = await mint({
      sub: world.ayseAuthId,
      phone: GUNES.guardian.phone,
    });
    expectError(
      await asUser('GET', `/v1/trips/${tripId}`, {
        token: ayseToken,
        client: 'parent',
        tenantId: world.gunes.tenantId,
      }),
      403,
      'forbidden',
    );
    expectError(
      await asUser('GET', `/v1/trips/${tripId}`, {
        token: await mint({
          sub: world.denizAuthId,
          phone: MAVI.admin.phone,
          email: MAVI.admin.email,
        }),
        client: 'admin',
        tenantId: world.mavi.tenantId,
        extraHeaders: { 'x-device-id': randomUUID() },
      }),
      404,
      'not_found',
    );

    const before = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'BEFORE',
      vehicleEmptyConfirmed: true,
    });
    expect(before.status).toBe(200);

    const [startHasan, startElif] = await Promise.all([
      asUser('POST', `/v1/trips/${tripId}/start`, hasan),
      asUser('POST', `/v1/trips/${tripId}/start`, elif),
    ]);
    const startStatuses = [startHasan.status, startElif.status].sort();
    expect(startStatuses).toEqual([200, 409]);
    const startOk = startHasan.status === 200 ? startHasan : startElif;
    const startDenied = startHasan.status === 409 ? startHasan : startElif;
    expect(startOk.body['state']).toBe('ACTIVE');
    expect(startDenied.body['error']).toBe('illegal_transition');

    const opened = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(opened.status).toBe(200);
    assertNoOtpSecret(opened.body);
    const efeId = requireString(studentRow(opened.body['students'], world.studentId), 'id');
    const adaId = requireString(studentRow(opened.body['students'], world.adaStudentId), 'id');

    const [efeHasan, efeElif] = await Promise.all([
      command(hasan, tripId, { tripStudentId: efeId, action: 'BOARD', expectedStateSeq: 0 }),
      command(elif, tripId, { tripStudentId: efeId, action: 'BOARD', expectedStateSeq: 0 }),
    ]);
    expect(efeHasan.status).toBe(200);
    expect(efeElif.status).toBe(200);
    const efeOutcomes = [efeHasan.body['status'], efeElif.body['status']].slice().sort();
    expect(efeOutcomes).toEqual(['APPLIED', 'CONFLICT']);
    const afterSameChild = await asUser('GET', `/v1/trips/${tripId}`, elif);
    expect(studentRow(afterSameChild.body['students'], world.studentId)).toMatchObject({
      state: 'ON_BOARD',
      needsReview: true,
    });

    expectError(
      await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
        phase: 'AFTER',
        vehicleEmptyConfirmed: true,
      }),
      409,
      'vehicle_not_empty',
    );

    const incident = await asUser('POST', `/v1/trips/${tripId}/incidents`, elif, {
      body: 'Kapıda iki cihaz aynı çocuğa bastı, fotoğraftan doğruluyoruz',
      studentId: world.studentId,
    });
    expect(incident.status).toBe(200);

    const efeSeq = Number(studentRow(afterSameChild.body['students'], world.studentId)['stateSeq']);
    const [deliveredEfe, missedAda] = await Promise.all([
      command(hasan, tripId, {
        tripStudentId: efeId,
        action: 'DELIVER',
        expectedStateSeq: efeSeq,
      }),
      command(elif, tripId, {
        tripStudentId: adaId,
        action: 'MARK_NO_SHOW',
        expectedStateSeq: 0,
      }),
    ]);
    expect(deliveredEfe.body).toMatchObject({ status: 'APPLIED', state: 'DELIVERED' });
    expect(missedAda.body).toMatchObject({ status: 'APPLIED', state: 'NO_SHOW' });

    const afterEmpty = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'AFTER',
      vehicleEmptyConfirmed: true,
    });
    expect(afterEmpty.status).toBe(200);
    const emptyDetail = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(emptyDetail.body).toMatchObject({ checks: { before: true, after: true } });

    const lateAda = await command(hasan, tripId, {
      tripStudentId: adaId,
      action: 'BOARD',
      expectedStateSeq: 1,
    });
    expect(lateAda.body).toMatchObject({ status: 'APPLIED', state: 'ON_BOARD' });
    const afterLateBoard = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(afterLateBoard.body).toMatchObject({ checks: { before: true, after: false } });

    expectError(
      await asUser('POST', `/v1/trips/${tripId}/complete`, hasan),
      409,
      'students_still_on_trip',
    );
    expectError(
      await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, elif, {
        phase: 'AFTER',
        vehicleEmptyConfirmed: true,
      }),
      409,
      'vehicle_not_empty',
    );

    const droppedAda = await command(elif, tripId, {
      tripStudentId: adaId,
      action: 'DELIVER',
      expectedStateSeq: 2,
    });
    expect(droppedAda.body).toMatchObject({ status: 'APPLIED', state: 'DELIVERED' });
    const afterAgain = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, elif, {
      phase: 'AFTER',
      vehicleEmptyConfirmed: true,
    });
    expect(afterAgain.status).toBe(200);
    const completed = await asUser('POST', `/v1/trips/${tripId}/complete`, hasan);
    expect(completed.status).toBe(200);
    expect(completed.body['state']).toBe('COMPLETED');
    assertNoOtpSecret(completed.body);

    const afterDone = await command(hasan, tripId, {
      tripStudentId: efeId,
      action: 'BOARD',
      expectedStateSeq: 2,
    });
    expect(afterDone.body).toMatchObject({
      status: 'REJECTED',
      reason: 'TRIP_NOT_IN_REQUIRED_STATE',
    });
  });

  it('akşam olağanüstü teslim: kodsuz TEMP reddedilir, araçtaki çocuk seferi kilitler', async () => {
    const tripId = world.sep15AfternoonTripId;
    expect(tripId.length).toBeGreaterThan(0);
    const elif = await elifCrew();
    const hasan = await hasanCrew();
    await startActiveTrip(elif, tripId);

    const detail = await asUser('GET', `/v1/trips/${tripId}`, elif);
    expect(detail.status).toBe(200);
    assertNoOtpSecret(detail.body);
    const canId = requireString(studentRow(detail.body['students'], world.canStudentId), 'id');
    const efeId = requireString(studentRow(detail.body['students'], world.studentId), 'id');
    const adaId = requireString(studentRow(detail.body['students'], world.adaStudentId), 'id');

    const boardedCan = await command(elif, tripId, {
      tripStudentId: canId,
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(boardedCan.body).toMatchObject({ status: 'APPLIED', state: 'ON_BOARD' });

    await postgres.sql`
      update trip_student
      set delivery_target = 'TEMP'
      where id = ${canId}::uuid
    `;
    const tempDeliver = await command(elif, tripId, {
      tripStudentId: canId,
      action: 'DELIVER',
      expectedStateSeq: 1,
    });
    expect(tempDeliver.body).toMatchObject({
      status: 'REJECTED',
      reason: 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE',
      state: 'ON_BOARD',
    });

    const returned = await command(elif, tripId, {
      tripStudentId: canId,
      action: 'RETURN_HOME',
      expectedStateSeq: 1,
    });
    expect(returned.body).toMatchObject({
      status: 'REJECTED',
      reason: 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE',
      state: 'ON_BOARD',
    });

    const boardedEfe = await command(hasan, tripId, {
      tripStudentId: efeId,
      action: 'BOARD',
      expectedStateSeq: 0,
    });
    expect(boardedEfe.body).toMatchObject({ status: 'APPLIED', state: 'ON_BOARD' });
    const failed = await command(hasan, tripId, {
      tripStudentId: efeId,
      action: 'MARK_DELIVERY_FAILED',
      expectedStateSeq: 1,
    });
    expect(failed.body).toMatchObject({ status: 'APPLIED', state: 'DELIVERY_FAILED' });

    const missedAda = await command(elif, tripId, {
      tripStudentId: adaId,
      action: 'MARK_NO_SHOW',
      expectedStateSeq: 0,
    });
    expect(missedAda.body).toMatchObject({ status: 'APPLIED', state: 'NO_SHOW' });

    expectError(
      await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, elif, {
        phase: 'AFTER',
        vehicleEmptyConfirmed: true,
      }),
      409,
      'vehicle_not_empty',
    );
    expectError(
      await asUser('POST', `/v1/trips/${tripId}/complete`, elif),
      409,
      'students_still_on_trip',
    );

    const crewResolve = await command(hasan, tripId, {
      tripStudentId: efeId,
      action: 'RESOLVE_HANDED_TO_ADMIN',
      expectedStateSeq: 2,
    });
    expect(crewResolve.body).toMatchObject({
      status: 'REJECTED',
      reason: 'ROLE_NOT_ALLOWED',
      state: 'DELIVERY_FAILED',
    });

    const stuck = await asUser('GET', `/v1/trips/${tripId}`, elif);
    expect(stuck.body['state']).toBe('ACTIVE');
    expect(studentRow(stuck.body['students'], world.studentId)['state']).toBe('DELIVERY_FAILED');
    expect(studentRow(stuck.body['students'], world.canStudentId)['state']).toBe('ON_BOARD');
  });

  it('binme ve kapanış aynı anda yarışır; araçta çocukla COMPLETED yazılamaz', async () => {
    const admin = await selinAdmin();
    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-16',
      days: 1,
    });
    expect(generated.status).toBe(200);
    expect(generated.body['created']).toBe(2);

    const listed = await asUser('GET', '/v1/trips?date=2026-09-16', admin);
    const tripId = requireString(tripByRoute(requireItems(listed.body), world.routeId), 'id');
    const hasan = await hasanCrew();
    const elif = await elifCrew();
    await startActiveTrip(hasan, tripId);

    const detail = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    const efeId = requireString(studentRow(detail.body['students'], world.studentId), 'id');
    const adaId = requireString(studentRow(detail.body['students'], world.adaStudentId), 'id');
    for (const [id, seq] of [
      [efeId, 0],
      [adaId, 0],
    ] as const) {
      const marked = await command(elif, tripId, {
        tripStudentId: id,
        action: 'MARK_NO_SHOW',
        expectedStateSeq: seq,
      });
      expect(marked.body).toMatchObject({ status: 'APPLIED', state: 'NO_SHOW' });
    }

    const after = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'AFTER',
      vehicleEmptyConfirmed: true,
    });
    expect(after.status).toBe(200);

    const [completeRes, boardRes] = await Promise.all([
      asUser('POST', `/v1/trips/${tripId}/complete`, elif),
      command(hasan, tripId, {
        tripStudentId: efeId,
        action: 'BOARD',
        expectedStateSeq: 1,
      }),
    ]);

    const [tripRow] = await postgres.sql<{ state: string }[]>`
      select state::text as state from trip where id = ${tripId}::uuid
    `;
    const occupants = await postgres.sql<{ state: string }[]>`
      select state::text as state
      from trip_student
      where trip_id = ${tripId}::uuid and state in ('ON_BOARD', 'DELIVERY_FAILED')
    `;
    expect(completeRes.status === 200 && boardRes.body['status'] === 'APPLIED').toBe(false);
    if (tripRow?.state === 'COMPLETED') {
      expect(occupants).toHaveLength(0);
      expect(completeRes.status).toBe(200);
      expect(boardRes.body['status']).not.toBe('APPLIED');
    } else {
      expect(tripRow?.state).toBe('ACTIVE');
      expect(completeRes.status).toBe(409);
      expect(boardRes.body).toMatchObject({ status: 'APPLIED', state: 'ON_BOARD' });
    }
  });

  it('worker ufku kiracı saat diliminde doldurur; var olan seferi çoğaltmaz', async () => {
    const before = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from trip where tenant_id = ${world.gunes.tenantId}::uuid
    `;
    const result = await runTripHorizonJob(
      workerSql,
      createDbFromSql(workerSql),
      new Date('2026-09-10T08:00:00+03:00'),
    );
    expect(result.failed).toBe(0);
    expect(result.tenants).toBeGreaterThanOrEqual(2);
    expect(result.created).toBeGreaterThan(0);
    const again = await runTripHorizonJob(
      workerSql,
      createDbFromSql(workerSql),
      new Date('2026-09-10T08:00:00+03:00'),
    );
    expect(again.created).toBe(0);
    expect(again.failed).toBe(0);
    const after = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from trip where tenant_id = ${world.gunes.tenantId}::uuid
    `;
    expect(Number(after[0]?.n)).toBeGreaterThan(Number(before[0]?.n));
    const listed = await asUser('GET', '/v1/trips?date=2026-09-14', await selinAdmin());
    expect(listed.status).toBe(200);
    expect(requireItems(listed.body).length).toBe(2);
  });

  it('aynı telefon farklı isimde otomatik birleşmez', async () => {
    const admin = await selinAdmin();
    const clash = await asUser('POST', `/v1/admin/students/${world.studentId}/guardians`, admin, {
      fullName: 'Mehmet Demir',
      phone: GUNES.guardian.phone,
      relation: 'Baba',
    });
    expect(clash.status).toBe(409);
    expect(clash.body['error']).toBe('phone_in_use');
  });

  it('üyelik açık olsa da iptal ilişki çocuğu gizler; davet studentId taşımaz', async () => {
    const admin = await selinAdmin();
    const extra = await asUser('POST', '/v1/admin/students', admin, {
      fullName: 'Lara Demir',
      schoolId: world.schoolId,
      grade: '1-A',
      handoverPolicy: 'GUARDIAN_REQUIRED',
      enrollmentStart: '2026-09-01',
      usesMorning: false,
      usesEvening: true,
    });
    expect(extra.status).toBe(200);
    const studentId = requireString(extra.body, 'id');
    const guardian = await asUser('POST', `/v1/admin/students/${studentId}/guardians`, admin, {
      fullName: GUNES.guardian.fullName,
      phone: GUNES.guardian.phone,
      relation: 'Anne',
    });
    expect(guardian.status).toBe(200);
    const membershipId = requireString(guardian.body, 'membershipId');

    const invite = await asUser('POST', '/v1/admin/invites', admin, { membershipId });
    expect(invite.status).toBe(200);
    expect(invite.body['studentId']).toBeUndefined();
    expect(invite.body['membershipId']).toBe(membershipId);
    const token = requireString(invite.body, 'token');

    const publicInvite = await request('GET', `/v1/invites/${token}`, {});
    expect(publicInvite.status).toBe(200);
    expect(publicInvite.body['tenantName']).toBe(GUNES.name);

    const parentToken = await mint({ sub: world.ayseAuthId, phone: GUNES.guardian.phone });
    const parent = {
      token: parentToken,
      client: 'parent' as const,
      tenantId: world.gunes.tenantId,
    };
    const children = await asUser('GET', '/v1/parent/children', parent);
    expect(children.status).toBe(200);
    const items = requireItems(children.body);
    expect(items.some((item) => item['studentId'] === studentId)).toBe(true);
    const lara = items.find((item) => item['studentId'] === studentId);
    expect(lara?.['morningPlanStatus']).toBe('NO_SERVICE');
    expect(lara?.['eveningPlanStatus']).toBe('PREPARING');

    const revoked = await asUser(
      'POST',
      `/v1/admin/students/${studentId}/guardians/${membershipId}/revoke`,
      admin,
    );
    expect(revoked.status).toBe(200);
    const after = await asUser('GET', '/v1/parent/children', parent);
    expect(requireItems(after.body).some((item) => item['studentId'] === studentId)).toBe(false);
  });

  it('import satırları ayrı işler ve benzersiz telefon sayısını verir', async () => {
    const admin = await selinAdmin();
    const preview = await asUser('POST', '/v1/admin/imports/preview', admin, {
      fileName: 'sinif.xlsx',
      fileHash: `hash-${randomUUID()}`,
      rows: [
        {
          rowNo: 1,
          studentFullName: 'Kerem Ak',
          schoolId: world.schoolId,
          enrollmentStart: '2026-09-01',
          guardianFullName: 'Sevgi Ak',
          guardianPhone: '+905321110077',
          relation: 'Anne',
        },
        {
          rowNo: 2,
          studentFullName: 'Deniz Ak',
          schoolId: world.schoolId,
          enrollmentStart: '2026-09-01',
          guardianFullName: 'Sevgi Ak',
          guardianPhone: '+905321110077',
          relation: 'Anne',
        },
        {
          rowNo: 3,
          studentFullName: 'Yanlış',
          schoolId: randomUUID(),
          enrollmentStart: '2026-09-01',
          guardianFullName: 'Xe',
          guardianPhone: '+905321110078',
          relation: 'Baba',
        },
      ],
    });
    expect(preview.status).toBe(200);
    const summary = preview.body['summary'];
    expect(summary).toMatchObject({
      ready: 2,
      needsFix: 1,
      uniqueGuardianPhones: 1,
    });
    const batchId = requireString(preview.body, 'id');
    const committed = await asUser('POST', `/v1/admin/imports/${batchId}/commit`, admin, {
      onlyReady: true,
    });
    expect(committed.status).toBe(200);
    expect(committed.body['summary']).toMatchObject({ committed: 2, needsFix: 1 });
    const [written] = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from student
      where tenant_id = ${world.gunes.tenantId}::uuid
        and full_name in ('Kerem Ak', 'Deniz Ak')
    `;
    expect(written?.n).toBe('2');
    const again = await asUser('POST', `/v1/admin/imports/${batchId}/commit`, admin, {
      onlyReady: true,
    });
    expect(again.status).toBe(200);
    expect(again.body['summary']).toMatchObject({ committed: 2, needsFix: 1 });
    const [rewritten] = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from student
      where tenant_id = ${world.gunes.tenantId}::uuid
        and full_name in ('Kerem Ak', 'Deniz Ak')
    `;
    expect(rewritten?.n).toBe('2');
  });

  it('şoför eksiği yayını bozmaz; sefer READY olamaz', async () => {
    const admin = await selinAdmin();
    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-20',
      days: 1,
    });
    expect(generated.status).toBe(200);
    const [planned] = await postgres.sql<{ id: string }[]>`
      select id::text
      from trip
      where tenant_id = ${world.gunes.tenantId}::uuid
        and service_date = '2026-09-20'
        and state = 'PLANNED'
        and current_driver_membership_id is not null
      limit 1
    `;
    expect(planned?.id).toBeTruthy();
    const tripId = planned?.id;
    if (!tripId) throw new Error('şoförsüz sefer testi için sefer yok');
    await postgres.sql`
      update trip
      set current_driver_membership_id = null
      where id = ${tripId}::uuid
    `;
    const hasan = await hasanCrew();
    const before = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'BEFORE',
      vehicleEmptyConfirmed: true,
    });
    expect(before.status).toBe(409);
    expect(before.body['error']).toBe('crew_incomplete');
    const [state] = await postgres.sql<{ state: string }[]>`
      select state::text from trip where id = ${tripId}::uuid
    `;
    expect(state?.state).toBe('PLANNED');
  });

  it('personel listesi velileri karıştırmaz; olay ve istisna dürüst boştur', async () => {
    const admin = await selinAdmin();
    const staff = await asUser('GET', '/v1/admin/staff', admin);
    expect(staff.status).toBe(200);
    const roles = requireItems(staff.body).flatMap((item) => {
      const listed = item['roles'];
      if (!Array.isArray(listed)) return [] as string[];
      return listed.filter((role): role is string => typeof role === 'string');
    });
    expect(roles).toContain('ADMIN');
    expect(roles).not.toContain('GUARDIAN');
    const events = await asUser('GET', '/v1/admin/events', admin);
    expect(events.status).toBe(200);
    expect(events.body['available']).toBe(true);
    expect(Array.isArray(events.body['items'])).toBe(true);
    expect(typeof events.body['csv']).toBe('string');
    expect(String(events.body['csv'])).toMatch(/^seq,occurred_at,event_type/);
    expect(String(events.body['csv'])).not.toMatch(/Efe Demir|Ayşe Demir|\+90532|otpCode/i);
    const exceptions = await asUser('GET', '/v1/admin/exceptions', admin);
    expect(exceptions.status).toBe(200);
    expect(exceptions.body['available']).toBe(true);
    expect(Array.isArray(exceptions.body['exceptions'])).toBe(true);
    expect(Array.isArray(exceptions.body['overrides'])).toBe(true);
    expect(Array.isArray(exceptions.body['addressChanges'])).toBe(true);
    assertNoOtpSecret(exceptions.body);
  });

  it('canlı GPS: epoch, sıçrama, 1 yayın ve veli gizliliği', async () => {
    const admin = await selinAdmin();
    await postgres.sql`
      update stop set lat = 40.9713 where id = ${world.homeStopId}::uuid
    `;
    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-21',
      days: 1,
    });
    expect(generated.status).toBe(200);
    const hasan = await hasanCrew();
    const elif = await elifCrew();
    const listed = await asUser('GET', '/v1/trips?date=2026-09-21', hasan);
    expect(listed.status).toBe(200);
    const morning = tripByRoute(requireItems(listed.body), world.routeId);
    const tripId = requireString(morning, 'id');
    await startActiveTrip(hasan, tripId);

    const detail = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(detail.status).toBe(200);
    const epoch = Number(detail.body['locationSessionEpoch']);
    expect(epoch).toBeGreaterThanOrEqual(1);
    expect(detail.body['locationSourceDeviceId']).toBe(world.hasanDevice);
    expect(detail.body['live']).toBeNull();

    const staleEpoch = await pingLocation(hasan, tripId, {
      lat: 40.9713,
      lng: 29.0756,
      sessionEpoch: 0,
    });
    expectError(staleEpoch, 409, 'wrong_epoch');

    const hostessEarly = await pingLocation(elif, tripId, {
      lat: 40.9714,
      lng: 29.0757,
      sessionEpoch: epoch,
    });
    expectError(hostessEarly, 409, 'wrong_device');

    const first = await pingLocation(hasan, tripId, {
      lat: 40.9713,
      lng: 29.0756,
      sessionEpoch: epoch,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ accepted: true, quality: 'GOOD', trackingEnded: false });
    expect(first.body['sessionEpoch']).toBe(epoch);
    const [archivedOnce] = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from vehicle_location_ping where trip_id = ${tripId}::uuid
    `;
    expect(Number(archivedOnce?.n ?? 0)).toBe(1);
    const [homeArrived] = await postgres.sql<{ hit: boolean }[]>`
      select actual_arrived_at is not null as hit
      from trip_stop
      where trip_id = ${tripId}::uuid
      order by seq
      limit 1
    `;
    expect(homeArrived?.hit).toBe(true);
    const [baselineRow] = await postgres.sql<{ n: number; has_baseline: boolean }[]>`
      select routes_calls_count as n, route_baseline is not null as has_baseline
      from trip where id = ${tripId}::uuid
    `;
    expect(baselineRow?.has_baseline).toBe(true);
    expect(Number(baselineRow?.n ?? 0)).toBe(0);

    const jump = await pingLocation(hasan, tripId, {
      lat: 41.08,
      lng: 29.2,
      sessionEpoch: epoch,
    });
    expect(jump.status).toBe(200);
    expect(jump.body).toMatchObject({ accepted: false, quality: 'REJECTED' });
    expect(asText(jump.body['reason'])).toMatch(/sıçrama|hız/i);
    expect(data.realtime.vehicleBroadcasts(tripId)).toHaveLength(1);

    const liveAfterJump = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(liveAfterJump.status).toBe(200);
    const live = liveAfterJump.body['live'];
    expect(isRecord(live)).toBe(true);
    if (isRecord(live)) {
      expect(Number(live['lat'])).toBeCloseTo(40.9713, 4);
      expect(Number(live['lng'])).toBeCloseTo(29.0756, 4);
    }

    const second = await pingLocation(hasan, tripId, {
      lat: 40.97135,
      lng: 29.07565,
      sessionEpoch: epoch,
    });
    expect(second.status).toBe(200);
    expect(second.body['accepted']).toBe(true);

    const broadcasts = data.realtime.vehicleBroadcasts(tripId);
    expect(broadcasts).toHaveLength(2);
    expect(
      broadcasts.every(
        (item) =>
          Object.keys(item.payload).sort().join() ===
          ['heading', 'quality', 'recordedAt', 'vehicleLat', 'vehicleLng'].sort().join(),
      ),
    ).toBe(true);

    await postgres.sql`
      update vehicle_current_location
      set recorded_at = now() - interval '61 seconds',
          received_at = now() - interval '61 seconds'
      where trip_id = ${tripId}::uuid
    `;
    const failover = await pingLocation(elif, tripId, {
      lat: 40.9714,
      lng: 29.0757,
      sessionEpoch: epoch,
    });
    expect(failover.status, JSON.stringify(failover.body)).toBe(200);
    expect(failover.body['accepted']).toBe(true);
    const newEpoch = Number(failover.body['sessionEpoch']);
    expect(newEpoch).toBeGreaterThan(epoch);
    expect(failover.body['locationSourceDeviceId']).toBe(world.elifDevice);

    const oldSource = await pingLocation(hasan, tripId, {
      lat: 40.9715,
      lng: 29.0758,
      sessionEpoch: epoch,
    });
    expectError(oldSource, 409, 'wrong_device');
    const staleHostessEpoch = await pingLocation(elif, tripId, {
      lat: 40.97141,
      lng: 29.07571,
      sessionEpoch: epoch,
    });
    expectError(staleHostessEpoch, 409, 'wrong_epoch');

    const parent = await ayseParent();
    const home = await asUser('GET', '/v1/parent/home', parent);
    expect(home.status).toBe(200);
    const children = home.body['children'];
    expect(Array.isArray(children)).toBe(true);
    const efeHome = Array.isArray(children)
      ? children.filter(isRecord).find((item) => item['studentId'] === world.studentId)
      : undefined;
    expect(efeHome, JSON.stringify(home.body)).toBeTruthy();
    const liveHome = isRecord(efeHome) ? efeHome['live'] : null;
    expect(isRecord(liveHome), JSON.stringify(efeHome)).toBe(true);
    if (isRecord(liveHome)) {
      expect(liveHome['tripId']).toBe(tripId);
      expect(liveHome['studentId']).toBe(world.studentId);
      const own = liveHome['ownStop'];
      expect(isRecord(own)).toBe(true);
      if (isRecord(own)) {
        expect(String(own['label'])).toContain('Demir');
      }
      expect(JSON.stringify(liveHome)).not.toMatch(/Fenerbahçe|Mühürdar/);
    }

    const tracking = await asUser(
      'GET',
      `/v1/parent/trips/${tripId}/tracking?studentId=${world.studentId}`,
      parent,
    );
    expect(tracking.status, JSON.stringify(tracking.body)).toBe(200);
    expect(tracking.body['studentId']).toBe(world.studentId);
    expect(JSON.stringify(tracking.body)).not.toMatch(
      /Fenerbahçe|Mühürdar|etaSeconds|etaConfidence|eta_confidence/i,
    );
    expect(asText(tracking.body['etaText'])).toMatch(/Yaklaşık|Yaklaşıyor|\d+-\d+ dk/);
    expect(asText(tracking.body['etaText'])).not.toMatch(/saniye/i);
    const ownStop = tracking.body['ownStop'];
    expect(isRecord(ownStop)).toBe(true);
    expect(data.realtime.viewerCount(tripId)).toBe(1);

    const adaAsAyse = await asUser(
      'GET',
      `/v1/parent/trips/${tripId}/tracking?studentId=${world.adaStudentId}`,
      parent,
    );
    expectError(adaAsAyse, 404, 'not_found');
    const ghostStudent = await asUser(
      'GET',
      `/v1/parent/trips/${tripId}/tracking?studentId=${randomUUID()}`,
      parent,
    );
    expectError(ghostStudent, 404, 'not_found');

    const stranger = await asUser('GET', `/v1/parent/trips/${tripId}/tracking`, {
      token: await mint({
        sub: world.denizAuthId,
        phone: MAVI.admin.phone,
        email: MAVI.admin.email,
      }),
      client: 'parent',
      tenantId: world.mavi.tenantId,
    });
    expectError(stranger, 403, 'forbidden');

    const crewAsParent = await asUser('GET', `/v1/trips/${tripId}`, parent);
    expectError(crewAsParent, 403, 'forbidden');

    const efeOnTrip = studentRow(detail.body['students'], world.studentId);
    const expectedStop = requireStops(detail.body).find(
      (row) => row['id'] === efeOnTrip['expectedStopId'],
    );
    expect(expectedStop, JSON.stringify(detail.body['stops'])).toBeTruthy();
    const approachLat = Number(expectedStop?.['lat']);
    const approachLng = Number(expectedStop?.['lng']);
    const approaching = await pingLocation(elif, tripId, {
      lat: approachLat,
      lng: approachLng,
      sessionEpoch: newEpoch,
    });
    expect(approaching.status).toBe(200);
    const approachingAgain = await pingLocation(elif, tripId, {
      lat: approachLat + 0.00001,
      lng: approachLng + 0.00001,
      sessionEpoch: newEpoch,
    });
    expect(approachingAgain.status).toBe(200);
    const [notifyAfter] = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from notification
      where trip_id = ${tripId}::uuid and type = 'APPROACH'
    `;
    expect(Number(notifyAfter?.n ?? 0)).toBeGreaterThan(0);
    const approachThird = await pingLocation(elif, tripId, {
      lat: approachLat + 0.00002,
      lng: approachLng + 0.00002,
      sessionEpoch: newEpoch,
    });
    expect(approachThird.status).toBe(200);
    const [notifyOnce] = await postgres.sql<{ n: string }[]>`
      select count(*)::text as n from notification
      where trip_id = ${tripId}::uuid and type = 'APPROACH'
    `;
    expect(Number(notifyOnce?.n ?? 0)).toBe(Number(notifyAfter?.n ?? 0));

    await postgres.sql`update platform_settings set kill_gps = true`;
    try {
      const killed = await pingLocation(elif, tripId, {
        lat: 40.9713,
        lng: 29.0756,
        sessionEpoch: newEpoch,
      });
      expectError(killed, 409, 'gps_killed');
    } finally {
      await postgres.sql`update platform_settings set kill_gps = false`;
    }

    const beforeRt = data.realtime.vehicleBroadcasts(tripId).length;
    await postgres.sql`update platform_settings set kill_realtime = true`;
    try {
      const silent = await pingLocation(elif, tripId, {
        lat: 40.97132,
        lng: 29.07562,
        sessionEpoch: newEpoch,
      });
      expect(silent.status).toBe(200);
      expect(silent.body['accepted']).toBe(true);
      expect(data.realtime.vehicleBroadcasts(tripId)).toHaveLength(beforeRt);
      const pollWhileSilent = await asUser(
        'GET',
        `/v1/parent/trips/${tripId}/tracking?studentId=${world.studentId}`,
        parent,
      );
      expect(pollWhileSilent.status).toBe(200);
    } finally {
      await postgres.sql`update platform_settings set kill_realtime = false`;
    }

    const students = detail.body['students'];
    if (Array.isArray(students)) {
      for (const row of students.filter(isRecord)) {
        const tripStudentId = requireString(row, 'id');
        const seq = Number(row['stateSeq'] ?? 0);
        const marked = await command(elif, tripId, {
          tripStudentId,
          action: 'MARK_NO_SHOW',
          expectedStateSeq: seq,
        });
        expect(marked.status, JSON.stringify(marked.body)).toBe(200);
      }
    }
    const afterNoShow = await asUser(
      'GET',
      `/v1/parent/trips/${tripId}/tracking?studentId=${world.studentId}`,
      parent,
    );
    expectError(afterNoShow, 410, 'tracking_ended');
    const after = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, elif, {
      phase: 'AFTER',
      vehicleEmptyConfirmed: true,
    });
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    const completed = await asUser('POST', `/v1/trips/${tripId}/complete`, elif);
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(data.realtime.endedTripIds()).toContain(tripId);

    const ended = await asUser(
      'GET',
      `/v1/parent/trips/${tripId}/tracking?studentId=${world.studentId}`,
      parent,
    );
    expectError(ended, 410, 'tracking_ended');
    expect(data.realtime.viewerCount(tripId)).toBe(0);
    const homeEnded = await asUser('GET', '/v1/parent/home', parent);
    expect(homeEnded.status).toBe(200);
    const endedChildren = homeEnded.body['children'];
    const efeEnded = Array.isArray(endedChildren)
      ? endedChildren.filter(isRecord).find((item) => item['studentId'] === world.studentId)
      : undefined;
    const leftoverLive = isRecord(efeEnded) ? efeEnded['live'] : null;
    if (isRecord(leftoverLive)) {
      expect(leftoverLive['tripId']).not.toBe(tripId);
      expect(leftoverLive['trackingEnded']).toBe(false);
    }

    const afterEnd = await pingLocation(elif, tripId, {
      lat: 40.9713,
      lng: 29.0756,
      sessionEpoch: newEpoch,
    });
    expectError(afterEnd, 409, 'trip_not_active');
  });

  it('canlı GPS: kalite reddi, stale gizleme ve olay-güdümlü baseline', async () => {
    const admin = await selinAdmin();
    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: '2026-09-22',
      days: 1,
    });
    expect(generated.status).toBe(200);
    const hasan = await hasanCrew();
    const listed = await asUser('GET', '/v1/trips?date=2026-09-22', hasan);
    expect(listed.status).toBe(200);
    const morning = tripByRoute(requireItems(listed.body), world.routeId);
    const tripId = requireString(morning, 'id');
    await startActiveTrip(hasan, tripId);
    const detail = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(detail.status).toBe(200);
    const epoch = Number(detail.body['locationSessionEpoch']);

    const first = await pingLocation(hasan, tripId, {
      lat: 40.9713,
      lng: 29.0756,
      sessionEpoch: epoch,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const orderedStops = requireStops(detail.body)
      .slice()
      .sort((a, b) => Number(a['seq']) - Number(b['seq']));
    const stopTwo = orderedStops[1];
    expect(stopTwo, JSON.stringify(orderedStops)).toBeTruthy();
    await postgres.sql`
      update vehicle_current_location
      set recorded_at = now() - interval '3 minutes'
      where trip_id = ${tripId}::uuid
    `;
    const arriveTwo = await pingLocation(hasan, tripId, {
      lat: Number(stopTwo?.['lat']),
      lng: Number(stopTwo?.['lng']),
      sessionEpoch: epoch,
    });
    expect(arriveTwo.status, JSON.stringify(arriveTwo.body)).toBe(200);
    expect(arriveTwo.body['accepted']).toBe(true);
    const [segmentSamples] = await postgres.sql<{ n: string }[]>`
      select coalesce(sum(sample_count), 0)::text as n
      from route_segment_stat
      where route_id = ${world.routeId}::uuid
    `;
    expect(Number(segmentSamples?.n ?? 0)).toBeGreaterThanOrEqual(1);
    const lat2 = Number(stopTwo?.['lat']);
    const lng2 = Number(stopTwo?.['lng']);

    const fuzzy = await pingLocation(hasan, tripId, {
      lat: lat2 + 0.00001,
      lng: lng2 + 0.00001,
      sessionEpoch: epoch,
      accuracyM: 80,
    });
    expect(fuzzy.status).toBe(200);
    expect(fuzzy.body).toMatchObject({ accepted: false, quality: 'REJECTED' });
    expect(asText(fuzzy.body['reason'])).toMatch(/doğruluğu/i);

    const tooFast = await pingLocation(hasan, tripId, {
      lat: lat2 + 0.00002,
      lng: lng2 + 0.00002,
      sessionEpoch: epoch,
      speedMps: 50,
    });
    expect(tooFast.status).toBe(200);
    expect(tooFast.body).toMatchObject({ accepted: false, quality: 'REJECTED' });
    expect(asText(tooFast.body['reason'])).toMatch(/hız/i);

    const staleClock = await pingLocation(hasan, tripId, {
      lat: lat2 + 0.00003,
      lng: lng2 + 0.00003,
      sessionEpoch: epoch,
      recordedAt: new Date(Date.now() - 90_000).toISOString(),
    });
    expect(staleClock.status).toBe(200);
    expect(staleClock.body).toMatchObject({ accepted: false, quality: 'REJECTED' });
    expect(asText(staleClock.body['reason'])).toMatch(/eski/i);

    const futureClock = await pingLocation(hasan, tripId, {
      lat: lat2 + 0.00004,
      lng: lng2 + 0.00004,
      sessionEpoch: epoch,
      recordedAt: new Date(Date.now() + 30_000).toISOString(),
    });
    expect(futureClock.status).toBe(200);
    expect(futureClock.body).toMatchObject({ accepted: false, quality: 'REJECTED' });

    const liveAfterRejects = await asUser('GET', `/v1/trips/${tripId}`, hasan);
    expect(liveAfterRejects.status).toBe(200);
    const kept = liveAfterRejects.body['live'];
    expect(isRecord(kept)).toBe(true);
    if (isRecord(kept)) {
      expect(Number(kept['lat'])).toBeCloseTo(lat2, 4);
    }

    const low = await pingLocation(hasan, tripId, {
      lat: lat2 + 0.00001,
      lng: lng2 + 0.00001,
      sessionEpoch: epoch,
      accuracyM: 55,
    });
    expect(low.status).toBe(200);
    expect(low.body).toMatchObject({ accepted: true, quality: 'LOW' });
    const lowBroadcasts = data.realtime.vehicleBroadcasts(tripId);
    expect(lowBroadcasts.at(-1)?.payload.quality).toBe('LOW');

    await postgres.sql`
      update trip
      set last_routes_call_at = now() - interval '6 minutes',
          routes_calls_count = 1
      where id = ${tripId}::uuid
    `;
    await postgres.sql`
      update vehicle_current_location
      set recorded_at = now() - interval '20 seconds'
      where trip_id = ${tripId}::uuid
    `;
    const drifted = await pingLocation(hasan, tripId, {
      lat: lat2 + 0.0045,
      lng: lng2 + 0.0045,
      sessionEpoch: epoch,
    });
    expect(drifted.status, JSON.stringify(drifted.body)).toBe(200);
    expect(drifted.body['accepted']).toBe(true);
    const [refreshed] = await postgres.sql<{ n: number; age_sec: number }[]>`
      select
        routes_calls_count as n,
        extract(epoch from (now() - last_routes_call_at))::int as age_sec
      from trip where id = ${tripId}::uuid
    `;
    expect(Number(refreshed?.n ?? 0)).toBe(1);
    expect(Number(refreshed?.age_sec ?? 99)).toBeLessThan(15);

    await postgres.sql`
      update vehicle_current_location
      set recorded_at = now() - interval '4 minutes'
      where trip_id = ${tripId}::uuid
    `;
    const parent = await ayseParent();
    const staleView = await asUser(
      'GET',
      `/v1/parent/trips/${tripId}/tracking?studentId=${world.studentId}`,
      parent,
    );
    expect(staleView.status, JSON.stringify(staleView.body)).toBe(200);
    expect(staleView.body['liveAvailable']).toBe(false);
    expect(staleView.body['vehicle']).toBeNull();
    expect(asText(staleView.body['staleMessage'])).toMatch(/güncellenemiyor/);

    const students = (await asUser('GET', `/v1/trips/${tripId}`, hasan)).body['students'];
    if (Array.isArray(students)) {
      for (const row of students.filter(isRecord)) {
        const marked = await command(hasan, tripId, {
          tripStudentId: requireString(row, 'id'),
          action: 'MARK_NO_SHOW',
          expectedStateSeq: Number(row['stateSeq'] ?? 0),
        });
        expect(marked.status, JSON.stringify(marked.body)).toBe(200);
      }
    }
    const after = await asUser('POST', `/v1/trips/${tripId}/vehicle-checks`, hasan, {
      phase: 'AFTER',
      vehicleEmptyConfirmed: true,
    });
    expect(after.status).toBe(200);
    const completed = await asUser('POST', `/v1/trips/${tripId}/complete`, hasan);
    expect(completed.status).toBe(200);
  });

  it('veli geliştirme girişi telefonla jeton verir', async () => {
    const login = await request(
      'POST',
      '/v1/dev/parent-login',
      {},
      {
        phone: GUNES.guardian.phone,
        password: 'e2e-dev-login-parola1',
      },
    );
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const token = requireString(login.body, 'token');
    const session = await asUser('GET', '/v1/session', {
      token,
      client: 'parent',
      tenantId: world.gunes.tenantId,
    });
    expect(session.status).toBe(200);
    expectMembership(session.body, {
      membershipId: world.guardianMembershipId,
      status: 'ACTIVE',
      role: 'GUARDIAN',
    });
  });

  async function generateDay(date: string) {
    const admin = await selinAdmin();
    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: date,
      days: 1,
    });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    const listed = await asUser('GET', `/v1/trips?date=${date}`, admin);
    expect(listed.status).toBe(200);
    return {
      morningId: requireString(tripByRoute(requireItems(listed.body), world.routeId), 'id'),
      afternoonId: requireString(
        tripByRoute(requireItems(listed.body), world.afternoonRouteId),
        'id',
      ),
    };
  }

  function istanbulToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
  }

  function ymdAdd(ymd: string, days: number): string {
    const at = new Date(`${ymd}T12:00:00.000Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
  }

  function exceptionDate(offset: number): string {
    const today = istanbulToday();
    const floor = today > '2026-09-22' ? today : '2026-09-23';
    let date = ymdAdd(floor, offset);
    if (date === '2026-09-11') date = ymdAdd(date, 1);
    return date;
  }

  it('PLANNED seferde bugün binmeyecek sessiz ABSENT_PLANNED yazar', async () => {
    const serviceDate = exceptionDate(0);
    const parent = await ayseParent();
    const created = await asUser('POST', '/v1/parent/exceptions', parent, {
      studentId: world.studentId,
      serviceDate,
      segments: ['MORNING'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const again = await asUser('POST', '/v1/parent/exceptions', parent, {
      studentId: world.studentId,
      serviceDate,
      segments: ['MORNING'],
    });
    expectError(again, 409, 'exception_exists');

    const { morningId } = await generateDay(serviceDate);
    const hasan = await hasanCrew();
    const detail = await asUser('GET', `/v1/trips/${morningId}`, hasan);
    expect(detail.status).toBe(200);
    const efe = studentRow(detail.body['students'], world.studentId);
    expect(efe['state']).toBe('ABSENT_PLANNED');
    expect(detail.body['pendingAlerts']).toEqual([]);
    assertNoOtpSecret(detail.body);

    const day = await asUser(
      'GET',
      `/v1/parent/students/${world.studentId}/day?date=${serviceDate}`,
      parent,
    );
    expect(day.status).toBe(200);
    expect(day.body['morningAbsent']).toBe(true);
    expect(day.body['eveningAbsent']).toBe(false);
    expect(day.body['morningExceptionId']).toBeTruthy();
    const past = await asUser('POST', '/v1/parent/exceptions', parent, {
      studentId: world.studentId,
      serviceDate: '2020-01-01',
      segments: ['MORNING'],
    });
    expectError(past, 400, 'past_date');
  });

  it('ACTIVE seferde istisna uyarı çıkarır; ack olmadan komut durur', async () => {
    const serviceDate = exceptionDate(1);
    const { morningId } = await generateDay(serviceDate);
    const hasan = await hasanCrew();
    await startActiveTrip(hasan, morningId);
    const parent = await ayseParent();
    const created = await asUser('POST', '/v1/parent/exceptions', parent, {
      studentId: world.studentId,
      serviceDate,
      segments: ['MORNING'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);

    const beforeAck = await asUser('GET', `/v1/trips/${morningId}`, hasan);
    expect(beforeAck.status).toBe(200);
    const alerts = beforeAck.body['pendingAlerts'];
    expect(Array.isArray(alerts) && alerts.length).toBeGreaterThan(0);
    const alert = Array.isArray(alerts) ? alerts.filter(isRecord)[0] : undefined;
    if (!alert) throw new Error('kritik uyarı yok');
    const alertId = requireString(alert, 'id');
    const efe = studentRow(beforeAck.body['students'], world.studentId);
    expect(efe['state']).toBe('ABSENT_PLANNED');
    const ada = studentRow(beforeAck.body['students'], world.adaStudentId);
    assertNoOtpSecret(beforeAck.body);

    const clientEventId = randomUUID();
    const blocked = await command(hasan, morningId, {
      tripStudentId: requireString(ada, 'id'),
      action: 'BOARD',
      expectedStateSeq: Number(ada['stateSeq'] ?? 0),
      clientEventId,
    });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(200);
    expect(blocked.body['status']).toBe('REJECTED');
    expect(blocked.body['reason']).toBe('CRITICAL_CHANGE_UNACKED');
    expect(blocked.body['replay']).toBe(false);

    const ack = await asUser('POST', `/v1/trips/${morningId}/alerts/${alertId}/ack`, hasan);
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);

    const afterAck = await asUser('GET', `/v1/trips/${morningId}`, hasan);
    expect(afterAck.status).toBe(200);
    expect(afterAck.body['pendingAlerts']).toEqual([]);
    const adaAfter = studentRow(afterAck.body['students'], world.adaStudentId);
    const boarded = await command(hasan, morningId, {
      tripStudentId: requireString(adaAfter, 'id'),
      action: 'BOARD',
      expectedStateSeq: Number(adaAfter['stateSeq'] ?? 0),
      clientEventId,
    });
    expect(boarded.status, JSON.stringify(boarded.body)).toBe(200);
    expect(boarded.body['status']).toBe('APPLIED');
    expect(boarded.body['replay']).toBe(false);
  });

  it('ON_BOARD iken bugün binmeyecek 409 döner ve operasyon gerçeğini ezmez', async () => {
    const serviceDate = exceptionDate(2);
    const { morningId } = await generateDay(serviceDate);
    const hasan = await hasanCrew();
    await startActiveTrip(hasan, morningId);
    const detail = await asUser('GET', `/v1/trips/${morningId}`, hasan);
    const efe = studentRow(detail.body['students'], world.studentId);
    const boarded = await command(hasan, morningId, {
      tripStudentId: requireString(efe, 'id'),
      action: 'BOARD',
      expectedStateSeq: Number(efe['stateSeq'] ?? 0),
    });
    expect(boarded.status, JSON.stringify(boarded.body)).toBe(200);
    expect(boarded.body['status']).toBe('APPLIED');

    const parent = await ayseParent();
    const denied = await asUser('POST', '/v1/parent/exceptions', parent, {
      studentId: world.studentId,
      serviceDate,
      segments: ['MORNING'],
    });
    expectError(denied, 409, 'student_on_board');
    const after = await asUser('GET', `/v1/trips/${morningId}`, hasan);
    expect(studentRow(after.body['students'], world.studentId)['state']).toBe('ON_BOARD');
  });

  it('yakın pin AUTO OTP verir; beş yanlış kilitler; yönetici override ile teslim olur', async () => {
    const serviceDate = exceptionDate(3);
    const parent = await ayseParent();
    const created = await asUser('POST', '/v1/parent/delivery-overrides', parent, {
      studentId: world.studentId,
      serviceDate,
      lat: 40.972,
      lng: 29.076,
      addressText: 'Erenköy Mah. geçici bırakış no:12',
      receiverName: 'Mehmet Demir',
      receiverPhone: '+905321110077',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body['status']).toBe('ACTIVE');
    const otpCode = requireString(created.body, 'otpCode');
    expect(otpCode).toMatch(/^\d{6}$/);
    const overrideId = requireString(created.body, 'id');
    const resent = await asUser(
      'POST',
      `/v1/parent/delivery-overrides/${overrideId}/resend`,
      parent,
    );
    expect(resent.status, JSON.stringify(resent.body)).toBe(200);
    expect(resent.body['otpCode']).toBe(otpCode);

    const { morningId, afternoonId } = await generateDay(serviceDate);
    const hasan = await hasanCrew();
    const morning = await asUser('GET', `/v1/trips/${morningId}`, hasan);
    expect(studentRow(morning.body['students'], world.studentId)['deliveryTarget']).toBe('SCHOOL');
    const listed = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    expect(listed.status).toBe(200);
    assertNoOtpSecret(listed.body);
    const efe = studentRow(listed.body['students'], world.studentId);
    expect(efe['deliveryTarget']).toBe('TEMP');
    expect(efe['receiverName']).toBe('Mehmet Demir');
    expect(asText(efe['snapshotDropoffText'])).toMatch(/geçici bırakış/);
    expect(efe['deliveryVerified']).toBe(false);

    const adminList = await asUser('GET', '/v1/admin/exceptions', await selinAdmin());
    expect(adminList.status).toBe(200);
    assertNoOtpSecret(adminList.body);
    const listedOverrides = adminList.body['overrides'];
    expect(Array.isArray(listedOverrides)).toBe(true);
    const adminOverride = Array.isArray(listedOverrides)
      ? listedOverrides.filter(isRecord).find((row) => row['id'] === overrideId)
      : undefined;
    expect(adminOverride?.['status']).toBe('ACTIVE');
    expect(Number(adminOverride?.['detourM'] ?? 0)).toBeLessThanOrEqual(
      Number(adminOverride?.['maxDetourM'] ?? 1500),
    );

    await startActiveTrip(hasan, afternoonId);
    const live = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    const liveEfe = studentRow(live.body['students'], world.studentId);
    const boarded = await command(hasan, afternoonId, {
      tripStudentId: requireString(liveEfe, 'id'),
      action: 'BOARD',
      expectedStateSeq: Number(liveEfe['stateSeq'] ?? 0),
    });
    expect(boarded.status, JSON.stringify(boarded.body)).toBe(200);
    expect(boarded.body['status']).toBe('APPLIED');
    const tripStudentId = requireString(liveEfe, 'id');
    const wrong = otpCode === '000000' ? '111111' : '000000';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const mismatch = await asUser('POST', `/v1/trips/${afternoonId}/otp/verify`, hasan, {
        tripStudentId,
        code: wrong,
      });
      expectError(mismatch, 409, 'otp_mismatch');
    }
    const [attempts] = await postgres.sql<{ attempt_count: number }[]>`
      select attempt_count from delivery_override where id = ${overrideId}::uuid
    `;
    expect(Number(attempts?.attempt_count ?? 0)).toBe(4);
    const locked = await asUser('POST', `/v1/trips/${afternoonId}/otp/verify`, hasan, {
      tripStudentId,
      code: wrong,
    });
    expectError(locked, 409, 'otp_locked');
    const stillLocked = await asUser('POST', `/v1/trips/${afternoonId}/otp/verify`, hasan, {
      tripStudentId,
      code: otpCode,
    });
    expectError(stillLocked, 409, 'otp_locked');

    const admin = await selinAdmin();
    const overridden = await asUser(
      'POST',
      `/v1/admin/delivery-overrides/${overrideId}/admin-verify`,
      admin,
      { tripStudentId, reason: 'Beş yanlış sonrası yönetici teslim onayı' },
    );
    expect(overridden.status, JSON.stringify(overridden.body)).toBe(200);

    const verified = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    expect(studentRow(verified.body['students'], world.studentId)['deliveryVerified']).toBe(true);
    assertNoOtpSecret(verified.body);
    const afterVerify = studentRow(verified.body['students'], world.studentId);
    const delivered = await command(hasan, afternoonId, {
      tripStudentId,
      action: 'DELIVER',
      expectedStateSeq: Number(afterVerify['stateSeq'] ?? 0),
      receiverMembershipId: world.guardianMembershipId,
    });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect(delivered.body['status']).toBe('APPLIED');
  });

  it('uzak pin yönetici onayı ister; onaydan sonra TEMP ve veli kodu görünür', async () => {
    const serviceDate = exceptionDate(4);
    const { afternoonId } = await generateDay(serviceDate);
    const hasan = await hasanCrew();
    const before = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    expect(studentRow(before.body['students'], world.studentId)['deliveryTarget']).toBe('HOME');

    const parent = await ayseParent();
    const created = await asUser('POST', '/v1/parent/delivery-overrides', parent, {
      studentId: world.studentId,
      serviceDate,
      lat: 41.01,
      lng: 29.0755,
      addressText: 'Bostancı sahil geçici teslim noktası',
      receiverName: 'Zeynep Demir',
      receiverPhone: '+905321110078',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body['status']).toBe('PENDING_APPROVAL');
    expect(created.body['otpCode']).toBeNull();
    expect(Number(created.body['detourM'])).toBeGreaterThan(Number(created.body['maxDetourM']));
    const overrideId = requireString(created.body, 'id');

    const stillHome = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    expect(studentRow(stillHome.body['students'], world.studentId)['deliveryTarget']).toBe('HOME');

    const admin = await selinAdmin();
    const approved = await asUser(
      'POST',
      `/v1/admin/delivery-overrides/${overrideId}/approve`,
      admin,
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    assertNoOtpSecret(approved.body);

    const after = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    expect(after.status).toBe(200);
    const efe = studentRow(after.body['students'], world.studentId);
    expect(efe['deliveryTarget']).toBe('TEMP');
    expect(efe['receiverName']).toBe('Zeynep Demir');
    assertNoOtpSecret(after.body);

    const day = await asUser(
      'GET',
      `/v1/parent/students/${world.studentId}/day?date=${serviceDate}`,
      parent,
    );
    expect(day.status).toBe(200);
    const override = day.body['deliveryOverride'];
    expect(isRecord(override)).toBe(true);
    if (isRecord(override)) {
      expect(override['status']).toBe('ACTIVE');
      expect(asText(override['otpCode'])).toMatch(/^\d{6}$/);
    }
  });

  it('adres değişikliği onaylanır, üretilmiş sefer anlığı değişmez', async () => {
    const serviceDate = exceptionDate(5);
    const { afternoonId } = await generateDay(serviceDate);
    const hasan = await hasanCrew();
    const before = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    const snapshot = asText(
      studentRow(before.body['students'], world.studentId)['snapshotDropoffText'],
    );
    expect(snapshot.length).toBeGreaterThan(3);

    const parent = await ayseParent();
    const requested = await asUser('POST', '/v1/parent/address-changes', parent, {
      studentId: world.studentId,
      lat: 40.98,
      lng: 29.08,
      addressText: 'Fenerbahçe Mah. yeni kalıcı adres 7',
      effectiveFromDate: serviceDate,
    });
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    const requestId = requireString(requested.body, 'id');

    const admin = await selinAdmin();
    const approved = await asUser('POST', `/v1/admin/address-changes/${requestId}/approve`, admin);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    const after = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    expect(
      asText(studentRow(after.body['students'], world.studentId)['snapshotDropoffText']),
    ).toBe(snapshot);
    const [row] = await postgres.sql<{ text: string }[]>`
      select a.text
      from student_address sa
      join address a on a.id = sa.address_id
      where sa.student_id = ${world.studentId}::uuid
        and sa.usage = 'DROPOFF'
        and sa.valid_from = ${serviceDate}
      limit 1
    `;
    expect(row?.text).toMatch(/Fenerbahçe/);
  });

  it('kill_otp açıkken kod üretimi ve doğrulama 409 otp_killed döner', async () => {
    const serviceDate = exceptionDate(6);
    const parent = await ayseParent();
    const created = await asUser('POST', '/v1/parent/delivery-overrides', parent, {
      studentId: world.studentId,
      serviceDate,
      lat: 40.972,
      lng: 29.076,
      addressText: 'Erenköy Mah. kill otp denemesi',
      receiverName: 'Mehmet Demir',
      receiverPhone: '+905321110079',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const overrideId = requireString(created.body, 'id');
    const { afternoonId } = await generateDay(serviceDate);
    const hasan = await hasanCrew();
    const listed = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    const tripStudentId = requireString(studentRow(listed.body['students'], world.studentId), 'id');
    await postgres.sql`update platform_settings set kill_otp = true`;
    try {
      const resend = await asUser(
        'POST',
        `/v1/parent/delivery-overrides/${overrideId}/resend`,
        parent,
      );
      expectError(resend, 409, 'otp_killed');
      const verify = await asUser('POST', `/v1/trips/${afternoonId}/otp/verify`, hasan, {
        tripStudentId,
        code: '123456',
      });
      expectError(verify, 409, 'otp_killed');
      const another = await asUser('POST', '/v1/parent/delivery-overrides', parent, {
        studentId: world.studentId,
        serviceDate: exceptionDate(7),
        lat: 40.972,
        lng: 29.076,
        addressText: 'Erenköy Mah. ikinci kill denemesi',
        receiverName: 'Mehmet Demir',
        receiverPhone: '+905321110080',
      });
      expectError(another, 409, 'otp_killed');
    } finally {
      await postgres.sql`update platform_settings set kill_otp = false`;
    }
  });

  it('sabah istisnası akşam farklı teslimatı iptal etmez', async () => {
    const serviceDate = exceptionDate(8);
    const parent = await ayseParent();
    const override = await asUser('POST', '/v1/parent/delivery-overrides', parent, {
      studentId: world.studentId,
      serviceDate,
      lat: 40.972,
      lng: 29.076,
      addressText: 'Erenköy Mah. sabah istisnası ile birlikte',
      receiverName: 'Mehmet Demir',
      receiverPhone: '+905321110081',
    });
    expect(override.status, JSON.stringify(override.body)).toBe(200);
    expect(override.body['status']).toBe('ACTIVE');
    const absent = await asUser('POST', '/v1/parent/exceptions', parent, {
      studentId: world.studentId,
      serviceDate,
      segments: ['MORNING'],
    });
    expect(absent.status, JSON.stringify(absent.body)).toBe(200);
    const { morningId, afternoonId } = await generateDay(serviceDate);
    const hasan = await hasanCrew();
    const morning = await asUser('GET', `/v1/trips/${morningId}`, hasan);
    expect(studentRow(morning.body['students'], world.studentId)['state']).toBe('ABSENT_PLANNED');
    const afternoon = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    const efe = studentRow(afternoon.body['students'], world.studentId);
    expect(efe['state']).toBe('EXPECTED');
    expect(efe['deliveryTarget']).toBe('TEMP');
    assertNoOtpSecret(afternoon.body);
    const day = await asUser(
      'GET',
      `/v1/parent/students/${world.studentId}/day?date=${serviceDate}`,
      parent,
    );
    expect(day.status).toBe(200);
    expect(day.body['morningAbsent']).toBe(true);
    expect(isRecord(day.body['deliveryOverride'])).toBe(true);
    if (isRecord(day.body['deliveryOverride'])) {
      expect(day.body['deliveryOverride']['status']).toBe('ACTIVE');
      expect(asText(day.body['deliveryOverride']['otpCode'])).toMatch(/^\d{6}$/);
    }
  });

  it('istisna iptali PLANLI seferde EXPECTED geri getirir', async () => {
    const serviceDate = exceptionDate(9);
    const parent = await ayseParent();
    const created = await asUser('POST', '/v1/parent/exceptions', parent, {
      studentId: world.studentId,
      serviceDate,
      segments: ['MORNING', 'AFTERNOON'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const { morningId, afternoonId } = await generateDay(serviceDate);
    const hasan = await hasanCrew();
    expect(
      studentRow(
        (await asUser('GET', `/v1/trips/${morningId}`, hasan)).body['students'],
        world.studentId,
      )['state'],
    ).toBe('ABSENT_PLANNED');
    const day = await asUser(
      'GET',
      `/v1/parent/students/${world.studentId}/day?date=${serviceDate}`,
      parent,
    );
    const morningExceptionId = asText(day.body['morningExceptionId']);
    const eveningExceptionId = asText(day.body['eveningExceptionId']);
    expect(morningExceptionId.length).toBeGreaterThan(8);
    expect(eveningExceptionId.length).toBeGreaterThan(8);
    const cancelled = await asUser(
      'POST',
      `/v1/parent/exceptions/${morningExceptionId}/cancel`,
      parent,
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const after = await asUser('GET', `/v1/trips/${morningId}`, hasan);
    expect(studentRow(after.body['students'], world.studentId)['state']).toBe('EXPECTED');
    expect(
      studentRow(
        (await asUser('GET', `/v1/trips/${afternoonId}`, hasan)).body['students'],
        world.studentId,
      )['state'],
    ).toBe('ABSENT_PLANNED');
  });

  it('personel ebeveyn istisna uçlarına giremez; kod personel yanıtında yok', async () => {
    const serviceDate = exceptionDate(10);
    const hasan = await hasanCrew();
    const denied = await asUser('POST', '/v1/parent/exceptions', hasan, {
      studentId: world.studentId,
      serviceDate,
      segments: ['MORNING'],
    });
    expectError(denied, 403, 'forbidden');
    const parent = await ayseParent();
    const created = await asUser('POST', '/v1/parent/exceptions', parent, {
      studentId: world.studentId,
      serviceDate,
      segments: ['AFTERNOON'],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const { afternoonId } = await generateDay(serviceDate);
    const detail = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    expect(detail.status).toBe(200);
    expect(studentRow(detail.body['students'], world.studentId)['state']).toBe('ABSENT_PLANNED');
    assertNoOtpSecret(detail.body);
  });

  it('farklı teslimat iptali PLANLI seferde evi geri verir; araçtayken reddedilir', async () => {
    const plannedDate = exceptionDate(11);
    const parent = await ayseParent();
    const created = await asUser('POST', '/v1/parent/delivery-overrides', parent, {
      studentId: world.studentId,
      serviceDate: plannedDate,
      lat: 40.972,
      lng: 29.076,
      addressText: 'Erenköy Mah. iptal denemesi',
      receiverName: 'Mehmet Demir',
      receiverPhone: '+905321110082',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const overrideId = requireString(created.body, 'id');
    const { afternoonId } = await generateDay(plannedDate);
    const hasan = await hasanCrew();
    const before = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    expect(studentRow(before.body['students'], world.studentId)['deliveryTarget']).toBe('TEMP');
    const cancelled = await asUser(
      'POST',
      `/v1/parent/delivery-overrides/${overrideId}/cancel`,
      parent,
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const after = await asUser('GET', `/v1/trips/${afternoonId}`, hasan);
    const restored = studentRow(after.body['students'], world.studentId);
    expect(restored['deliveryTarget']).toBe('HOME');
    expect(asText(restored['snapshotDropoffText'])).not.toMatch(/iptal denemesi/);

    const boardedDate = exceptionDate(12);
    const second = await asUser('POST', '/v1/parent/delivery-overrides', parent, {
      studentId: world.studentId,
      serviceDate: boardedDate,
      lat: 40.972,
      lng: 29.076,
      addressText: 'Erenköy Mah. araçtayken iptal',
      receiverName: 'Mehmet Demir',
      receiverPhone: '+905321110083',
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const liveOverrideId = requireString(second.body, 'id');
    const { afternoonId: liveAfternoonId } = await generateDay(boardedDate);
    await startActiveTrip(hasan, liveAfternoonId);
    const live = await asUser('GET', `/v1/trips/${liveAfternoonId}`, hasan);
    const efe = studentRow(live.body['students'], world.studentId);
    const boarded = await command(hasan, liveAfternoonId, {
      tripStudentId: requireString(efe, 'id'),
      action: 'BOARD',
      expectedStateSeq: Number(efe['stateSeq'] ?? 0),
    });
    expect(boarded.body['status']).toBe('APPLIED');
    const denied = await asUser(
      'POST',
      `/v1/parent/delivery-overrides/${liveOverrideId}/cancel`,
      parent,
    );
    expectError(denied, 409, 'student_on_board');
    const stillTemp = await asUser('GET', `/v1/trips/${liveAfternoonId}`, hasan);
    expect(studentRow(stillTemp.body['students'], world.studentId)['deliveryTarget']).toBe('TEMP');
  });

  it('sefer aracı/personel değişir, transfer zirve doluluğa bakar, olay ve öncelik dolar', async () => {
    const admin = await selinAdmin();
    const destVehicle = await asUser('POST', '/v1/admin/vehicles', admin, {
      plate: '34 GNS 08',
      seatCount: 16,
    });
    expect(destVehicle.status).toBe(200);
    const swapVehicle = await asUser('POST', '/v1/admin/vehicles', admin, {
      plate: '34 GNS 09',
      seatCount: 16,
    });
    expect(swapVehicle.status).toBe(200);
    const destVehicleId = requireString(destVehicle.body, 'id');
    const swapVehicleId = requireString(swapVehicle.body, 'id');

    const noraAddr = await asUser('POST', '/v1/admin/addresses', admin, {
      text: 'Rasimpaşa Mah. Mahmutbaba Sk. No:7',
      il: 'İstanbul',
      ilce: 'Kadıköy',
      lat: 40.9951,
      lng: 29.0312,
    });
    expect(noraAddr.status).toBe(200);
    const noraAddressId = requireString(noraAddr.body, 'id');
    const nora = await asUser('POST', '/v1/admin/students', admin, {
      fullName: 'Nora Şahin',
      schoolId: world.schoolId,
      grade: '3-A',
      handoverPolicy: 'GUARDIAN_REQUIRED',
      enrollmentStart: '2026-09-01',
      pickupAddressId: noraAddressId,
      dropoffAddressId: noraAddressId,
    });
    expect(nora.status).toBe(200);
    const noraStop = await asUser('POST', '/v1/admin/stops', admin, {
      addressId: noraAddressId,
      label: 'Rasimpaşa kapı',
      lat: 40.9952,
      lng: 29.0313,
    });
    expect(noraStop.status).toBe(200);

    const created = await asUser('POST', '/v1/admin/routes', admin, {
      vehicleId: destVehicleId,
      schoolId: world.schoolId,
      segment: 'MORNING',
      shiftNo: 1,
      effectiveFrom: '2026-09-09',
    });
    expect(created.status).toBe(200);
    const destRouteId = requireString(created.body, 'id');
    const draftId = requireString(created.body, 'draftVersionId');
    const filled = await asUser('PUT', `/v1/admin/route-versions/${draftId}/stops`, admin, {
      stops: [
        {
          stopId: requireString(noraStop.body, 'id'),
          kind: 'PICKUP',
          seq: 1,
          studentIds: [requireString(nora.body, 'id')],
        },
        {
          stopId: world.schoolStopId,
          kind: 'SCHOOL',
          seq: 2,
          studentIds: [],
        },
      ],
    });
    expect(filled.status, JSON.stringify(filled.body)).toBe(200);
    const published = await asUser('POST', `/v1/admin/route-versions/${draftId}/publish`, admin);
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    const opsDate = exceptionDate(20);
    const generated = await asUser('POST', '/v1/admin/trips/generate', admin, {
      fromDate: opsDate,
      days: 1,
    });
    expect(generated.status).toBe(200);
    const listed = await asUser('GET', `/v1/trips?date=${opsDate}`, admin);
    expect(listed.status).toBe(200);
    const sourceId = requireString(tripByRoute(requireItems(listed.body), world.routeId), 'id');
    const destId = requireString(tripByRoute(requireItems(listed.body), destRouteId), 'id');

    const before = await asUser('GET', `/v1/admin/trips/${sourceId}`, admin);
    expect(before.status).toBe(200);
    expect(before.body['seatCount']).toBe(16);
    expect(before.body['driverName']).toBe(GUNES.driver.fullName);
    const epoch0 = Number(before.body['locationSessionEpoch']);

    const tooSmall = await asUser('POST', `/v1/admin/trips/${sourceId}/vehicle`, admin, {
      vehicleId: world.minibusId,
      reason: 'Minibüs denemesi kapasiteyi aşar',
    });
    expectError(tooSmall, 409, 'capacity_exceeded');

    const swapped = await asUser('POST', `/v1/admin/trips/${sourceId}/vehicle`, admin, {
      vehicleId: swapVehicleId,
      reason: 'Asıl araç bakıma girdi',
    });
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(200);
    expect(swapped.body['plate']).toBe('34 GNS 09');
    const afterVehicle = await asUser('GET', `/v1/admin/trips/${sourceId}`, admin);
    expect(Number(afterVehicle.body['locationSessionEpoch'])).toBe(epoch0 + 1);
    expect(afterVehicle.body['locationSourceDeviceId']).toBeNull();
    expect(afterVehicle.body['live']).toBeNull();

    const extraDriver = await asUser('POST', '/v1/admin/staff', admin, {
      fullName: 'Murat Kaya',
      phone: '+905321110010',
      email: 'murat.kaya@gunesis.net',
      role: 'DRIVER',
    });
    expect(extraDriver.status).toBe(200);
    const extraDriverId = requireString(extraDriver.body, 'membershipId');
    const muratToken = await mint({
      sub: randomUUID(),
      phone: '+905321110010',
      email: 'murat.kaya@gunesis.net',
    });
    const muratSession = await asUser('GET', '/v1/session', { token: muratToken, client: 'crew' });
    expect(muratSession.status).toBe(200);
    const crewed = await asUser('POST', `/v1/admin/trips/${sourceId}/crew`, admin, {
      role: 'DRIVER',
      membershipId: extraDriverId,
      reason: 'Hasan izinli; Murat aldı',
    });
    expect(crewed.status, JSON.stringify(crewed.body)).toBe(200);
    const afterCrew = await asUser('GET', `/v1/admin/trips/${sourceId}`, admin);
    expect(afterCrew.body['driverMembershipId']).toBe(extraDriverId);
    expect(afterCrew.body['driverName']).toBe('Murat Kaya');
    expect(Number(afterCrew.body['locationSessionEpoch'])).toBe(epoch0 + 2);

    const moved = await asUser('POST', '/v1/admin/trip-moves', admin, {
      studentId: world.adaStudentId,
      serviceDate: opsDate,
      segment: 'MORNING',
      targetRouteId: destRouteId,
      reason: 'Ada ikinci sabah aracına alındı',
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({
      studentId: world.adaStudentId,
      sourceTripId: sourceId,
      targetTripId: destId,
      sourceState: 'MOVED_OUT',
    });
    const sourceDetail = await asUser('GET', `/v1/trips/${sourceId}`, admin);
    expect(studentRow(sourceDetail.body['students'], world.adaStudentId)['state']).toBe(
      'MOVED_OUT',
    );
    const destDetail = await asUser('GET', `/v1/trips/${destId}`, admin);
    expect(studentRow(destDetail.body['students'], world.adaStudentId)['state']).toBe('EXPECTED');
    const again = await asUser('POST', '/v1/admin/trip-moves', admin, {
      studentId: world.adaStudentId,
      serviceDate: opsDate,
      segment: 'MORNING',
      targetRouteId: destRouteId,
      reason: 'Aynı gün ikinci transfer yok',
    });
    expectError(again, 409, 'move_exists');

    const hasan = await hasanCrew();
    const restored = await asUser('POST', `/v1/admin/trips/${sourceId}/crew`, admin, {
      role: 'DRIVER',
      membershipId: world.driverMembershipId,
      reason: 'Hasan sefere geri döndü',
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    await startActiveTrip(hasan, sourceId);

    const stealVehicle = await asUser('POST', `/v1/admin/trips/${destId}/vehicle`, admin, {
      vehicleId: swapVehicleId,
      reason: 'Canlı seferdeki aracı ikinci sefere vermeyi dene',
    });
    expectError(stealVehicle, 409, 'vehicle_in_use');
    const stealCrew = await asUser('POST', `/v1/admin/trips/${destId}/crew`, admin, {
      role: 'DRIVER',
      membershipId: world.driverMembershipId,
      reason: 'Canlı seferdeki şoförü ikinci sefere vermeyi dene',
    });
    expectError(stealCrew, 409, 'crew_in_use');

    const activeDetail = await asUser('GET', `/v1/trips/${sourceId}`, hasan);
    expect(activeDetail.status).toBe(200);
    const liveEpoch = Number(activeDetail.body['locationSessionEpoch']);
    const ping = await pingLocation(hasan, sourceId, {
      lat: 40.9951,
      lng: 29.0312,
      sessionEpoch: liveEpoch,
    });
    expect(ping.status, JSON.stringify(ping.body)).toBe(200);
    expect(ping.body['accepted']).toBe(true);
    const withLive = await asUser('GET', `/v1/admin/trips/${sourceId}`, admin);
    expect(isRecord(withLive.body['live'])).toBe(true);

    const liveSwap = await asUser('POST', `/v1/admin/trips/${sourceId}/crew`, admin, {
      role: 'DRIVER',
      membershipId: extraDriverId,
      reason: 'Canlı seferde şoför değişti; eski GPS düşmeli',
    });
    expect(liveSwap.status, JSON.stringify(liveSwap.body)).toBe(200);
    const afterLiveSwap = await asUser('GET', `/v1/admin/trips/${sourceId}`, admin);
    expect(afterLiveSwap.body['live']).toBeNull();
    expect(Number(afterLiveSwap.body['locationSessionEpoch'])).toBeGreaterThan(liveEpoch);
    const staleDriverPing = await pingLocation(hasan, sourceId, {
      lat: 40.9952,
      lng: 29.0313,
      sessionEpoch: liveEpoch,
    });
    expectError(staleDriverPing, 409, 'wrong_device');

    const hasanBack = await asUser('POST', `/v1/admin/trips/${sourceId}/crew`, admin, {
      role: 'DRIVER',
      membershipId: world.driverMembershipId,
      reason: 'Hasan canlı sefere geri döndü',
    });
    expect(hasanBack.status, JSON.stringify(hasanBack.body)).toBe(200);

    await postgres.sql`
      update trip
      set actual_started_at = now() - interval '4 minutes'
      where id = ${sourceId}::uuid
    `;
    const priorities = await asUser('GET', `/v1/admin/priorities?date=${opsDate}`, admin);
    expect(priorities.status).toBe(200);
    const priorityItems = requireItems(priorities.body);
    expect(
      priorityItems.some((row) => row['kind'] === 'GPS_STALE' && row['tripId'] === sourceId),
    ).toBe(true);

    const boardedDate = exceptionDate(21);
    const { morningId } = await generateDay(boardedDate);
    await startActiveTrip(hasan, morningId);
    const live = await asUser('GET', `/v1/trips/${morningId}`, hasan);
    const ada = studentRow(live.body['students'], world.adaStudentId);
    const boarded = await command(hasan, morningId, {
      tripStudentId: requireString(ada, 'id'),
      action: 'BOARD',
      expectedStateSeq: Number(ada['stateSeq'] ?? 0),
    });
    expect(boarded.body['status']).toBe('APPLIED');
    const denied = await asUser('POST', '/v1/admin/trip-moves', admin, {
      studentId: world.adaStudentId,
      serviceDate: boardedDate,
      segment: 'MORNING',
      targetRouteId: destRouteId,
      reason: 'Araçtayken transfer denemesi',
    });
    expectError(denied, 409, 'student_on_board');
  });
});
