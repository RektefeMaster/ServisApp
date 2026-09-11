import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { devLoginInput, devParentLoginInput } from '@servisapp/contracts';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { supabaseIssuer } from '../../auth/jwt.js';
import type { AppData } from '../../data/ports.js';
import type { Env } from '../../env.js';
import { badRequest, unauthorized } from '../../http-error.js';

function passwordsMatch(provided: string, expected: string): boolean {
  const left = createHash('sha256').update(provided, 'utf8').digest();
  const right = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(left, right);
}

export function registerDevRoutes(app: FastifyInstance, env: Env, data: AppData): void {
  if (env.NODE_ENV === 'production' || !env.DEV_LOGIN_PASSWORD || !env.SUPABASE_JWT_SECRET) {
    return;
  }
  const password = env.DEV_LOGIN_PASSWORD;
  const secret = env.SUPABASE_JWT_SECRET;

  app.post('/v1/dev/login', async (request) => {
    const parsed = devLoginInput.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest('invalid_body', parsed.error.issues[0]?.message ?? 'Geçersiz istek');
    }
    if (!passwordsMatch(parsed.data.password, password)) {
      throw unauthorized('E-posta veya parola hatalı');
    }
    const identity = await data.session.findDevLoginIdentity(parsed.data.email);
    if (!identity) throw unauthorized('E-posta veya parola hatalı');
    if (!identity.hasCrewRole) throw unauthorized('E-posta veya parola hatalı');
    const authUserId = identity.authUserId ?? identity.identityId;
    const token = await new SignJWT({
      role: 'authenticated',
      email: identity.email,
      email_verified: true,
      phone: identity.phone,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(authUserId)
      .setIssuer(supabaseIssuer(env.SUPABASE_URL))
      .setAudience('authenticated')
      .setExpirationTime('12h')
      .sign(new TextEncoder().encode(secret));
    return {
      token,
      deviceHint: randomUUID(),
      identity: {
        identityId: identity.identityId,
        fullName: identity.fullName,
        email: identity.email,
      },
    };
  });

  app.post('/v1/dev/parent-login', async (request) => {
    const parsed = devParentLoginInput.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest('invalid_body', parsed.error.issues[0]?.message ?? 'Geçersiz istek');
    }
    if (!passwordsMatch(parsed.data.password, password)) {
      throw unauthorized('Telefon veya parola hatalı');
    }
    const identity = await data.session.findDevParentIdentity(parsed.data.phone);
    if (!identity) throw unauthorized('Telefon veya parola hatalı');
    const authUserId = identity.authUserId ?? identity.identityId;
    const token = await new SignJWT({
      role: 'authenticated',
      phone: identity.phone,
      ...(identity.email ? { email: identity.email, email_verified: true } : {}),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(authUserId)
      .setIssuer(supabaseIssuer(env.SUPABASE_URL))
      .setAudience('authenticated')
      .setExpirationTime('12h')
      .sign(new TextEncoder().encode(secret));
    return {
      token,
      identity: {
        identityId: identity.identityId,
        fullName: identity.fullName,
        phone: identity.phone,
      },
    };
  });
}
