import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { AppData } from './data/ports.js';
import type { Env } from './env.js';
import { HttpError } from './http-error.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerConfigRoutes } from './modules/config/routes.js';
import { registerHealthRoutes, type HealthDeps } from './modules/health/routes.js';
import { registerSessionRoutes } from './modules/session/routes.js';
import { Sentry } from './observability.js';
import { registerAuth } from './plugins/auth.js';
import { generateRequestId, registerRequestContext } from './plugins/request-context.js';

export interface AppDeps {
  env: Env;
  health: HealthDeps;
  data?: AppData;
}

export function buildApp({ env, health, data }: AppDeps): FastifyInstance {
  const app = Fastify({
    genReqId: generateRequestId,
    logger: {
      level: env.LOG_LEVEL,
      // Kişisel veri log'a düşmez: telefon, adres, OTP, push token.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.otp',
          '*.password',
          '*.phone',
          '*.pushToken',
        ],
        censor: '[gizlendi]',
      },
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: true,
    disableRequestLogging: false,
    bodyLimit: 1_048_576,
  });

  registerRequestContext(app);
  registerAuth(app, { env, data });

  void app.register(helmet, { contentSecurityPolicy: false });
  void app.register(cors, { origin: false });
  void app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Cihaz başına sınır: tünelden çıkan 100 aracın aynı anda senkronu
    // tek bir IP arkasından gelebilir (SPEC §13 "thundering herd").
    keyGenerator: (request) => {
      const device = request.headers['x-device-id'];
      return typeof device === 'string' ? device : (request.ip ?? 'unknown');
    },
  });

  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        requestId: request.id,
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
    registerSessionRoutes(app);
    registerAdminRoutes(app, data);
  }

  return app;
}
