import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { supabaseIssuer, verifyAccessToken } from './jwt.js';

const secret = 'test-secret-en-az-onalti-karakter';
const issuer = supabaseIssuer('https://test.supabase.co');
const sub = '00000000-0000-4000-8000-000000000004';

async function sign(claims: Record<string, unknown>, subValue = sub): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subValue)
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

function hsInput(): { secret: string; issuer: string; allowHs256: true } {
  return { secret, issuer, allowHs256: true };
}

describe('JWT doğrulama', () => {
  it('yalnız authenticated kullanıcı jetonunu kabul eder', async () => {
    const token = await sign({
      role: 'authenticated',
      phone: '+905321234567',
      email: 'ayse@example.com',
      email_verified: true,
      phone_verified: true,
    });
    await expect(verifyAccessToken(token, hsInput())).resolves.toMatchObject({
      authUserId: sub,
      phone: '+905321234567',
      email: 'ayse@example.com',
    });
  });

  it('service_role jetonunu reddeder', async () => {
    const token = await sign({ role: 'service_role' });
    await expect(verifyAccessToken(token, hsInput())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('iss veya aud uymayan jetonu reddeder', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('supabase')
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    await expect(verifyAccessToken(token, hsInput())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('UUID olmayan sub reddedilir', async () => {
    const token = await sign({ role: 'authenticated' }, 'not-a-uuid');
    await expect(verifyAccessToken(token, hsInput())).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('doğrulanmamış e-posta ile kimlik bağlanmaz', async () => {
    const token = await sign({
      role: 'authenticated',
      email: 'ayse@example.com',
    });
    const claims = await verifyAccessToken(token, hsInput());
    expect(claims.email).toBeNull();
  });

  it('user_metadata içindeki email_verified iddiayı bağlama için yetmez', async () => {
    const token = await sign({
      role: 'authenticated',
      email: 'ayse@example.com',
      user_metadata: { email_verified: true },
    });
    const claims = await verifyAccessToken(token, hsInput());
    expect(claims.email).toBeNull();
  });

  it('arti isareti olmadan gelen E.164 telefonu normalleştirir', async () => {
    const token = await sign({
      role: 'authenticated',
      phone: '905321234567',
      phone_verified: true,
    });
    const claims = await verifyAccessToken(token, hsInput());
    expect(claims.phone).toBe('+905321234567');
  });

  /**
   * Supabase'in GERÇEKTEN ürettiği jeton: üst seviyede `phone_verified` yok,
   * doğrulama bayrağı yalnız user_metadata'da. Bunu reddetmek üretimde her
   * girişi kırıyordu (bkz. jwt.ts `phoneVerified`).
   */
  it('gerçek Supabase jetonunda telefon üst seviye bayrak olmadan da okunur', async () => {
    const token = await sign({
      role: 'authenticated',
      aal: 'aal1',
      amr: [{ method: 'otp', timestamp: 1_700_000_000 }],
      app_metadata: { provider: 'phone', providers: ['phone'] },
      email: '',
      phone: '905321234567',
      session_id: '00000000-0000-4000-8000-0000000000ff',
      is_anonymous: false,
      user_metadata: { phone_verified: true, email_verified: false },
    });
    const claims = await verifyAccessToken(token, hsInput());
    expect(claims.phone).toBe('+905321234567');
    expect(claims.email).toBeNull();
  });

  it('telefonu boş olan jetonda telefon iddiası yoktur', async () => {
    const token = await sign({ role: 'authenticated', phone: '', email: 'ayse@example.com' });
    const claims = await verifyAccessToken(token, hsInput());
    expect(claims.phone).toBeNull();
  });

  it('üst seviye phone_verified false ise telefon reddedilir', async () => {
    const token = await sign({
      role: 'authenticated',
      phone: '+905321234567',
      phone_verified: false,
    });
    const claims = await verifyAccessToken(token, hsInput());
    expect(claims.phone).toBeNull();
  });

  it('user_metadata, üst seviyede reddedilmiş telefonu kurtaramaz', async () => {
    const token = await sign({
      role: 'authenticated',
      phone: '+905321234567',
      phone_verified: false,
      user_metadata: { phone_verified: true },
    });
    const claims = await verifyAccessToken(token, hsInput());
    expect(claims.phone).toBeNull();
  });

  it('HS256 jetonunu secret yokken reddeder', async () => {
    const token = await sign({ role: 'authenticated' });
    await expect(verifyAccessToken(token, { issuer })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('HS256 jetonunu allowHs256 kapalıyken secret varken de reddeder', async () => {
    const token = await sign({ role: 'authenticated' });
    await expect(verifyAccessToken(token, { secret, issuer })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('ES256 jetonunu JWKS ile doğrular', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-es256';
    jwk.alg = 'ES256';
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-es256', typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(privateKey);
    await expect(
      verifyAccessToken(token, { issuer, jwks: createLocalJWKSet({ keys: [jwk] }) }),
    ).resolves.toMatchObject({ authUserId: sub });
  });

  it('baska anahtarla imzalanmis ES256 jetonunu reddeder', async () => {
    const minted = await generateKeyPair('ES256', { extractable: true });
    const verifier = await generateKeyPair('ES256', { extractable: true });
    const jwk = await exportJWK(verifier.publicKey);
    jwk.kid = 'test-es256';
    jwk.alg = 'ES256';
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-es256', typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(minted.privateKey);
    await expect(
      verifyAccessToken(token, { issuer, jwks: createLocalJWKSet({ keys: [jwk] }) }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
