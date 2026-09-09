import type { FastifyInstance } from 'fastify';
import { unauthorized } from '../../http-error.js';

export function registerSessionRoutes(app: FastifyInstance): void {
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
}
