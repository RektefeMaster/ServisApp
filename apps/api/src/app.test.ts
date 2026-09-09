import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
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

function appWith(checkDatabase: () => Promise<void>) {
  return buildApp({ env: testEnv, health: { checkDatabase } });
}

describe('health uçları', () => {
  it('liveness bağımlılıklara bakmadan ok döner', async () => {
    const app = appWith(() => Promise.reject(new Error('DB kapalı')));
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('DB erişilemiyorsa readiness 503 döner', async () => {
    const app = appWith(() => Promise.reject(new Error('DB kapalı')));
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it('her yanıt izlenebilir bir requestId taşır', async () => {
    const app = appWith(() => Promise.resolve());
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.headers['x-request-id']).toBeTruthy();
    await app.close();
  });

  it('istemcinin gönderdiği geçerli requestId zinciri korur', async () => {
    const app = appWith(() => Promise.resolve());
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'crew-abc-123' },
    });
    expect(response.headers['x-request-id']).toBe('crew-abc-123');
    await app.close();
  });

  it('biçimsiz requestId log zincirine sokulmaz', async () => {
    const app = appWith(() => Promise.resolve());
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'kotu\ndeger "enjeksiyon"' },
    });
    expect(response.headers['x-request-id']).not.toBe('kotu\ndeger "enjeksiyon"');
    await app.close();
  });

  it('bilinmeyen uç 404 döner, iç detay sızdırmaz', async () => {
    const app = appWith(() => Promise.resolve());
    const response = await app.inject({ method: 'GET', url: '/gizli' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
    await app.close();
  });
});
