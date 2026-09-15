import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AppData } from './data/ports.js';
import type { Env } from './env.js';
import { HttpError } from './http-error.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerConfigRoutes } from './modules/config/routes.js';
import { registerDevRoutes } from './modules/dev/routes.js';
import { registerHealthRoutes, type HealthDeps } from './modules/health/routes.js';
import { registerParentRoutes } from './modules/parent/routes.js';
import { registerSessionRoutes } from './modules/session/routes.js';
import { registerTripAdminRoutes, registerTripRoutes } from './modules/trips/routes.js';
import { Sentry } from './observability.js';
import { registerAuth } from './plugins/auth.js';
import { createClientIp } from './plugins/client-ip.js';
import { generateRequestId, registerRequestContext } from './plugins/request-context.js';

export interface AppDeps {
  env: Env;
  health: HealthDeps;
  data?: AppData;
}

function adminCorsOrigin(origins: string | undefined): boolean | string | string[] {
  if (!origins) return false;
  const list = origins
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const [first, ...rest] = list;
  if (!first) return false;
  if (rest.length === 0) return first;
  return list;
}

function redactRequestUrl(url: string): string {
  return url.replace(/\/v1\/invites\/[^/?#]+/gi, '/v1/invites/[redacted]');
}

export function buildApp({ env, health, data }: AppDeps): FastifyInstance {
  const app = Fastify({
    genReqId: generateRequestId,
    logger: {
      level: env.LOG_LEVEL,
      // Kişisel veri log'a düşmez: telefon, adres, OTP, push token, davet token.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.otp',
          '*.otpCode',
          '*.password',
          '*.phone',
          '*.pushToken',
          '*.token',
          '*.inviteUrl',
        ],
        censor: '[gizlendi]',
      },
      serializers: {
        req(request) {
          const url = 'url' in request && typeof request.url === 'string' ? request.url : '';
          const method =
            'method' in request && typeof request.method === 'string' ? request.method : undefined;
          const host =
            'hostname' in request && typeof request.hostname === 'string'
              ? request.hostname
              : undefined;
          const ip = 'ip' in request && typeof request.ip === 'string' ? request.ip : undefined;
          return {
            method,
            url: redactRequestUrl(url),
            host,
            remoteAddress: ip,
          };
        },
      },
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    // Varsayılan false: X-Forwarded-For sahteciliği rate-limit'i aşamaz.
    // TRUST_PROXY yalnız IP/CIDR (asla true veya hop-count).
    trustProxy: env.TRUST_PROXY ?? false,
    bodyLimit: 1_048_576,
  });

  /**
   * Gövdesiz POST, `content-type: application/json` ile gelse bile kabul edilir.
   *
   * Fastify varsayılanı boş gövdeyi FST_ERR_CTP_EMPTY_JSON_BODY ile 400'e
   * düşürür. İstemcilerin çoğu (admin paneli dahil) content-type başlığını her
   * isteğe koyar; "rota sürümünü yayınla" ve "davet SMS'i gönder" gibi gövdesiz
   * uçlar bu yüzden hiç çalışmıyordu. Boş gövde = boş nesne.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      const text = body.trim();
      if (text.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text) as unknown);
      } catch {
        const error = new HttpError(400, 'invalid_body', 'Gövde geçerli JSON değil');
        done(error, undefined);
      }
    },
  );

  const clientIp = createClientIp(env.CLIENT_IP_HEADER);

  registerRequestContext(app);
  registerAuth(app, { env, data, clientIp });

  void app.register(helmet, { contentSecurityPolicy: false });
  void app.register(cors, {
    origin: adminCorsOrigin(env.ADMIN_ORIGINS),
    allowedHeaders: [
      'authorization',
      'content-type',
      'x-client',
      'x-tenant-id',
      'x-app-version',
      'x-device-id',
      'x-device-platform',
      'x-request-id',
    ],
    maxAge: 86_400,
  });
  void app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const path = request.url.split('?')[0] ?? request.url;
      if (
        path === '/v1/config' ||
        path === '/v1/dev/login' ||
        path === '/v1/dev/parent-login' ||
        /^\/v1\/invites\/[^/]+$/.test(path)
      ) {
        return `ip:${clientIp(request)}`;
      }
      const identityId = request.auth?.identityId;
      if (identityId) return `id:${identityId}`;
      // x-device-id istemci uydurmasıdır; bucket anahtarı olamaz.
      return `ip:${clientIp(request)}`;
    },
  });

  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        requestId: request.id,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'işlenmemiş hata');
      Sentry.captureException(error, { tags: { requestId: request.id } });
    }
    return reply.code(status).send({
      error: status >= 500 ? 'internal_error' : (error.code ?? 'bad_request'),
      message: status >= 500 ? 'Beklenmeyen bir hata oluştu' : error.message,
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: 'not_found', requestId: request.id }),
  );

  registerHealthRoutes(app, health);
  if (data) {
    registerConfigRoutes(app, data);
    registerDevRoutes(app, env, data);
    registerSessionRoutes(app, data);
    registerAdminRoutes(app, data);
    registerParentRoutes(app, data);
    registerTripAdminRoutes(app, data);
    registerTripRoutes(app, data);
  }

  return app;
}
