import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import type { AppData } from './data/ports.js';
import type { Env } from './env.js';

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

function sessionFor(role: 'ADMIN' | 'GUARDIAN' | 'DRIVER') {
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
        status: 'ACTIVE' as const,
        roles: [role],
      },
    ],
  };
}

function testData(role: 'ADMIN' | 'GUARDIAN' | 'DRIVER' = 'ADMIN'): {
  data: AppData;
  createSchool: ReturnType<typeof vi.fn>;
  pinAddress: ReturnType<typeof vi.fn>;
  resolve: ReturnType<typeof vi.fn>;
} {
  const createSchool = vi.fn(() => Promise.resolve({ id: randomUUID() }));
  const pinAddress = vi.fn(() => Promise.resolve({ id: randomUUID() }));
  const resolve = vi.fn(() => Promise.resolve(sessionFor(role)));
  return {
    createSchool,
    pinAddress,
    resolve,
    data: {
      getPlatform: vi.fn(() => Promise.resolve(platform)),
      session: {
        resolve,
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
      headers: { 'x-client': 'admin' },
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
});
