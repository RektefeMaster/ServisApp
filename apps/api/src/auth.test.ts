import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import type { AppData } from './data/ports.js';
import type { Env } from './env.js';
import { HttpError } from './http-error.js';

const testEnv: Env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  PORT: 0,
  DATABASE_URL: 'postgresql://localhost/test',
  WORKER_DATABASE_URL: 'postgresql://localhost/test',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_JWT_SECRET: 'test-secret-en-az-onalti-karakter',
  OTP_PEPPER: 'test-pepper-en-az-otuziki-karakter-olmali',
  OTP_ENCRYPTION_KEY: 'test-key-en-az-otuziki-karakter-olmali-x',
};

const tenantId = '00000000-0000-4000-8000-000000000001';
const membershipId = '00000000-0000-4000-8000-000000000002';
const identityId = '00000000-0000-4000-8000-000000000003';
const authUserId = '00000000-0000-4000-8000-000000000004';

const platform = {
  schemaVersion: 1,
  minSupportedAppVersion: '1.0.0',
  kills: { gps: false, otp: false, realtime: false },
  flags: { betaMap: false },
};

function sessionFor(
  role: 'ADMIN' | 'GUARDIAN' | 'DRIVER',
  status: 'ACTIVE' | 'INVITED' = 'ACTIVE',
) {
  return {
    identityId,
    fullName: 'Ayşe Yönetici',
    phone: '+905321234567',
    email: 'ayse@example.com',
    memberships: [
      {
        membershipId,
        tenantId,
        tenantName: 'Demo',
        status,
        roles: [role],
      },
    ],
  };
}

function testData(
  role: 'ADMIN' | 'GUARDIAN' | 'DRIVER' = 'ADMIN',
  status: 'ACTIVE' | 'INVITED' = 'ACTIVE',
): {
  data: AppData;
  createSchool: ReturnType<typeof vi.fn>;
  pinAddress: ReturnType<typeof vi.fn>;
  resolve: ReturnType<typeof vi.fn>;
} {
  const createSchool = vi.fn(() => Promise.resolve({ id: randomUUID() }));
  const pinAddress = vi.fn(() => Promise.resolve({ id: randomUUID() }));
  const resolve = vi.fn(() => Promise.resolve(sessionFor(role, status)));
  return {
    createSchool,
    pinAddress,
    resolve,
    data: {
      getPlatform: vi.fn(() => Promise.resolve(platform)),
      session: {
        resolve,
        findDevLoginIdentity: vi.fn(() => Promise.resolve(null)),
        findDevParentIdentity: vi.fn(() => Promise.resolve(null)),
      },
      admin: {
        pinAddress,
        listAddresses: vi.fn(() => Promise.resolve([])),
        createSchool,
        listSchools: vi.fn(() => Promise.resolve([])),
        createVehicle: vi.fn(() => Promise.resolve({ id: randomUUID() })),
        listVehicles: vi.fn(() => Promise.resolve([])),
        createStaff: vi.fn(() => Promise.resolve({ identityId, membershipId })),
        createStudent: vi.fn(() => Promise.resolve({ id: randomUUID() })),
        listStudents: vi.fn(() => Promise.resolve([])),
        createGuardian: vi.fn(() => Promise.resolve({ identityId, membershipId })),
        createStop: vi.fn(() => Promise.resolve({ id: randomUUID() })),
        listStops: vi.fn(() => Promise.resolve([])),
        createRoute: vi.fn(() =>
          Promise.resolve({ id: randomUUID(), draftVersionId: randomUUID() }),
        ),
        listRoutes: vi.fn(() => Promise.resolve([])),
        getRoute: vi.fn(() => Promise.resolve(null)),
        getRouteVersion: vi.fn(() => Promise.resolve(null)),
        replaceRouteStops: vi.fn(),
        suggestRouteStopOrder: vi.fn(),
        publishRouteVersion: vi.fn(),
        cloneRouteVersion: vi.fn(() => Promise.resolve({ id: randomUUID(), versionNo: 2 })),
        createHoliday: vi.fn(() =>
          Promise.resolve({ schoolId: randomUUID(), date: '2026-09-10', type: 'HOLIDAY' as const }),
        ),
        generateHorizon: vi.fn(() => Promise.resolve({ created: 0, skipped: 0, tripIds: [] })),
        listStaff: vi.fn(() => Promise.resolve([])),
        getStudent: vi.fn(() => Promise.resolve(null)),
        endStudent: vi.fn(),
        revokeGuardian: vi.fn(),
        changeUnactivatedPhone: vi.fn(),
        previewImport: vi.fn(),
        getImport: vi.fn(),
        commitImport: vi.fn(),
        createInvite: vi.fn(),
        sendInviteSms: vi.fn(),
        listTripsForDate: vi.fn(() => Promise.resolve([])),
        getTripDetail: vi.fn(() => Promise.resolve(null)),
        listEventsUnavailable: vi.fn((): { items: []; available: false } => ({
          items: [],
          available: false,
        })),
        listExceptions: vi.fn(() =>
          Promise.resolve({
            available: true as const,
            exceptions: [],
            overrides: [],
            addressChanges: [],
          }),
        ),
        approveDeliveryOverride: vi.fn(),
        rejectDeliveryOverride: vi.fn(),
        adminOverrideDelivery: vi.fn(),
        approveAddressChange: vi.fn(),
        rejectAddressChange: vi.fn(),
      },
      parent: {
        listChildren: vi.fn(() => Promise.resolve([])),
        previewInvite: vi.fn(() => Promise.resolve(null)),
        activateInvite: vi.fn(),
        getHome: vi.fn(() => Promise.resolve({ children: [] })),
        pollTracking: vi.fn(),
        createRideException: vi.fn(),
        cancelRideException: vi.fn(),
        createDeliveryOverride: vi.fn(),
        cancelDeliveryOverride: vi.fn(),
        resendDeliveryOtp: vi.fn(),
        getParentDayPlan: vi.fn(),
        createAddressChange: vi.fn(),
      },
      trips: {
        generateHorizon: vi.fn(() => Promise.resolve({ created: 0, skipped: 0, tripIds: [] })),
        listForDate: vi.fn(() => Promise.resolve([])),
        getDetail: vi.fn(() => Promise.resolve(null)),
        recordVehicleCheck: vi.fn(),
        startTrip: vi.fn(),
        completeTrip: vi.fn(),
        cancelTrip: vi.fn(),
        applyStudentCommand: vi.fn(),
        reportIncident: vi.fn(),
        ingestLocation: vi.fn(),
        verifyDeliveryOtp: vi.fn(),
        ackCriticalChange: vi.fn(),
      },
      realtime: {
        vehicleBroadcasts: vi.fn(() => []),
        endedTripIds: vi.fn(() => []),
        viewerCount: vi.fn(() => 0),
      },
    },
  };
}

async function token(sub = authUserId, extra: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({
    role: 'authenticated',
    phone: '+905321234567',
    email: 'ayse@example.com',
    email_verified: true,
    ...extra,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(`${testEnv.SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(testEnv.SUPABASE_JWT_SECRET));
}

function appWith(data: AppData = testData().data) {
  return buildApp({
    env: testEnv,
    data,
    health: { checkDatabase: () => Promise.resolve() },
  });
}

describe('kimlik ve kurulum', () => {
  const apps: ReturnType<typeof appWith>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('yapılandırmayı oturumsuz döner', async () => {
    const app = appWith();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      minSupportedAppVersion: '1.0.0',
      kills: { gps: false },
    });
  });

  it('eski personel uygulamasına 426 döner', async () => {
    const app = appWith();
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/config',
      headers: { 'x-client': 'crew', 'x-app-version': '0.9.0' },
    });
    expect(response.statusCode).toBe(426);
    expect(response.json()).toMatchObject({ error: 'upgrade_required' });
  });

  it('x-client olmadan oturum 400 döner; 426 atlanamaz', async () => {
    const { data, resolve } = testData('ADMIN');
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'client_required' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('eski personel sürümü oturumda da 426 döner', async () => {
    const { data, resolve } = testData('ADMIN');
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'crew',
        'x-app-version': '0.9.0',
      },
    });
    expect(response.statusCode).toBe(426);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('geçerli JWT ile oturumu çözer', async () => {
    const { data } = testData('ADMIN');
    const app = appWith(data);
    apps.push(app);
    const jwt = await token();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-client': 'admin',
        'x-app-version': '1.4.2',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ identityId, memberships: [{ tenantId }] });
  });

  it('service_role jetonunu 401 ile reddeder', async () => {
    const { data, resolve } = testData('ADMIN');
    const app = appWith(data);
    apps.push(app);
    const jwt = await token(authUserId, { role: 'service_role' });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-client': 'admin',
        'x-app-version': '1.4.2',
      },
    });
    expect(response.statusCode).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('veli okul açamaz', async () => {
    const { data, createSchool } = testData('GUARDIAN');
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/schools',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'admin',
        'x-app-version': '1.4.2',
        'x-tenant-id': tenantId,
      },
      payload: {
        name: 'Güneş',
        level: 'PRIMARY',
        addressId: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(createSchool).not.toHaveBeenCalled();
  });

  it('yönetici adres pinler', async () => {
    const { data, pinAddress } = testData('ADMIN');
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/addresses',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'admin',
        'x-app-version': '1.4.2',
        'x-tenant-id': tenantId,
      },
      payload: {
        text: 'Atatürk Cad. 1',
        il: 'İstanbul',
        ilce: 'Kadıköy',
        lat: 40.99,
        lng: 29.03,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(pinAddress).toHaveBeenCalledTimes(1);
  });

  it('imzasız istek 401 döner', async () => {
    const app = appWith();
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: { 'x-client': 'admin', 'x-app-version': '1.4.2' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('CORS preflight kimlik istemez', async () => {
    const app = appWith();
    apps.push(app);
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/session',
      headers: {
        origin: 'http://127.0.0.1:3001',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,x-client',
      },
    });
    expect(response.statusCode).not.toBe(400);
    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).not.toBe(403);
  });

  it('davet önizlemesi oturumsuz okunur', async () => {
    const { data } = testData();
    const previewInvite = vi.fn(() =>
      Promise.resolve({
        tenantName: 'Güneş Işığı Servis',
        phoneHint: '***0004',
        status: 'PENDING' as const,
      }),
    );
    data.parent.previewInvite = previewInvite;
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/invites/abcdefghijklmnop1234567890',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tenantName: 'Güneş Işığı Servis',
      status: 'PENDING',
    });
    expect(previewInvite).toHaveBeenCalledTimes(1);
  });

  it('INVITED yönetici şirket yazamaz', async () => {
    const { data, createSchool } = testData('ADMIN', 'INVITED');
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/schools',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'admin',
        'x-app-version': '1.4.2',
        'x-tenant-id': tenantId,
      },
      payload: {
        name: 'Güneş',
        level: 'PRIMARY',
        addressId: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(createSchool).not.toHaveBeenCalled();
  });

  it('INVITED veli çocuk listesini alamaz', async () => {
    const { data } = testData('GUARDIAN', 'INVITED');
    const listChildren = vi.fn(() => Promise.resolve([]));
    data.parent.listChildren = listChildren;
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/parent/children',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'parent',
        'x-app-version': '1.4.2',
        'x-tenant-id': tenantId,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(listChildren).not.toHaveBeenCalled();
  });

  it('INVITED veli daveti aktive edebilir', async () => {
    const { data } = testData('GUARDIAN', 'INVITED');
    const activateInvite = vi.fn(() => Promise.resolve({ membershipId, children: [] }));
    data.parent.activateInvite = activateInvite;
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parent/invites/activate',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'parent',
        'x-app-version': '1.4.2',
      },
      payload: { token: 'abcdefghijklmnop1234567890' },
    });
    expect(response.statusCode).toBe(200);
    expect(activateInvite).toHaveBeenCalledTimes(1);
  });

  it('bağlanmamış veli daveti JWT telefonuyla aktive eder', async () => {
    const { data, resolve } = testData('GUARDIAN', 'INVITED');
    resolve.mockRejectedValue(
      new HttpError(403, 'identity_not_provisioned', 'Bu hesap henüz tanımlanmamış'),
    );
    const activateInvite = vi.fn(() => Promise.resolve({ membershipId, children: [] }));
    data.parent.activateInvite = activateInvite;
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parent/invites/activate',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'parent',
        'x-app-version': '1.4.2',
      },
      payload: { token: 'abcdefghijklmnop1234567890' },
    });
    expect(response.statusCode).toBe(200);
    expect(activateInvite).toHaveBeenCalledWith('abcdefghijklmnop1234567890', {
      authUserId,
      identityId: '',
      phone: '+905321234567',
    });
  });

  it('yönetici sürüm kapısını atlayamaz', async () => {
    const { data, resolve } = testData('ADMIN');
    const app = appWith(data);
    apps.push(app);
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'admin',
      },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'app_version_required' });
    expect(resolve).not.toHaveBeenCalled();

    const outdated = await app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'admin',
        'x-app-version': '0.9.0',
      },
    });
    expect(outdated.statusCode).toBe(426);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('veli istemcisi yönetim uçlarını çağıramaz', async () => {
    const { data, createSchool } = testData('GUARDIAN');
    const app = appWith(data);
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/schools',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'parent',
        'x-app-version': '1.4.2',
        'x-tenant-id': tenantId,
      },
      payload: {
        name: 'Güneş',
        level: 'PRIMARY',
        addressId: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(createSchool).not.toHaveBeenCalled();
  });

  it('veli ana ekranı GUARDIAN üyelik ister; sefer listesini açmaz', async () => {
    const { data } = testData('GUARDIAN');
    const app = appWith(data);
    apps.push(app);
    const home = await app.inject({
      method: 'GET',
      url: '/v1/parent/home',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'parent',
        'x-app-version': '1.4.2',
        'x-tenant-id': tenantId,
      },
    });
    expect(home.statusCode).toBe(200);
    expect(home.json()).toMatchObject({ children: [] });

    const trips = await app.inject({
      method: 'GET',
      url: '/v1/trips?date=2026-09-11',
      headers: {
        authorization: `Bearer ${await token()}`,
        'x-client': 'parent',
        'x-app-version': '1.4.2',
        'x-tenant-id': tenantId,
      },
    });
    expect(trips.statusCode).toBe(403);
  });
});
