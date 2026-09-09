import { isAppVersionSupported } from '@servisapp/domain';
import type { FastifyInstance } from 'fastify';
import { snapshotToAuth, type AuthContext } from '../auth/context.js';
import { bearerToken, supabaseIssuer, verifyAccessToken } from '../auth/jwt.js';
import type { AppData } from '../data/ports.js';
import type { Env } from '../env.js';
import { badRequest, forbidden, unauthorized, upgradeRequired } from '../http-error.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | undefined;
  }
}

function headerString(
  value: string | string[] | undefined,
  code: string,
  message: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) || value.length === 0) {
    throw badRequest(code, message);
  }
  return value;
}

function parseClient(value: string | undefined): 'crew' | 'parent' | 'admin' | null {
  if (value === 'crew' || value === 'parent' || value === 'admin') return value;
  return null;
}

export function registerAuth(app: FastifyInstance, deps: { env: Env; data?: AppData }): void {
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (!path.startsWith('/v1')) return;

    if (!deps.data) {
      throw new Error('app data missing');
    }

    const publicConfig = request.method === 'GET' && path === '/v1/config';
    const client = parseClient(
      headerString(request.headers['x-client'], 'invalid_client', 'x-client geçersiz'),
    );

    if (!publicConfig && !client) {
      throw badRequest('client_required', 'x-client zorunlu (crew|parent|admin)');
    }

    if (client === 'crew' || client === 'parent') {
      const version = headerString(
        request.headers['x-app-version'],
        'invalid_app_version',
        'x-app-version geçersiz',
      );
      if (!version) {
        throw badRequest('app_version_required', 'x-app-version zorunlu');
      }
      const platform = await deps.data.getPlatform();
      if (!isAppVersionSupported(version, platform.minSupportedAppVersion)) {
        throw upgradeRequired(platform.minSupportedAppVersion);
      }
    }

    if (publicConfig) return;

    const token = bearerToken(request.headers.authorization);
    if (!token) throw unauthorized();

    const claims = await verifyAccessToken(token, {
      secret: deps.env.SUPABASE_JWT_SECRET,
      issuer: supabaseIssuer(deps.env.SUPABASE_URL),
    });
    const snapshot = await deps.data.session.resolve({
      authUserId: claims.authUserId,
      phone: claims.phone,
      email: claims.email,
    });
    if (snapshot.memberships.length === 0) {
      throw forbidden('Aktif şirket üyeliği yok');
    }

    const tenantId = headerString(
      request.headers['x-tenant-id'],
      'invalid_tenant',
      'x-tenant-id geçersiz',
    );
    request.auth = snapshotToAuth(claims.authUserId, snapshot, tenantId);

    if (path.startsWith('/v1/admin')) {
      if (!tenantId) throw badRequest('tenant_required', 'x-tenant-id zorunlu');
      if (!request.auth.membership) throw forbidden('Bu şirkete erişiminiz yok');
      if (!request.auth.membership.roles.includes('ADMIN')) {
        throw forbidden();
      }
    }
  });
}
