import { registerPushTokenInput } from '@servisapp/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { requireTenantId } from '../../auth/context.js';
import type { AppData } from '../../data/ports.js';
import { badRequest, forbidden, unauthorized } from '../../http-error.js';

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('invalid_body', result.error.issues[0]?.message ?? 'Geçersiz istek');
  }
  return result.data;
}

export function registerSessionRoutes(app: FastifyInstance, data: AppData): void {
  app.get('/v1/session', (request) => {
    const auth = request.auth;
    if (!auth) throw unauthorized();
    return {
      identityId: auth.identityId,
      fullName: auth.fullName,
      memberships: auth.memberships,
      membership: auth.membership,
    };
  });

  app.post('/v1/devices/push-token', async (request: FastifyRequest) => {
    const auth = request.auth;
    if (!auth?.membership) throw forbidden();
    if (auth.membership.status !== 'ACTIVE') throw forbidden();
    const input = parse(registerPushTokenInput, request.body);
    return data.devices.registerPushToken(
      requireTenantId(auth),
      auth.membership.membershipId,
      input,
    );
  });
}
