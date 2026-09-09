import type { FastifyInstance } from 'fastify';

export interface HealthDeps {
  /** Veritabanına gerçekten ulaşabiliyor muyuz — Fly'ın trafiği kesmesi için. */
  checkDatabase: () => Promise<void>;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  // Süreç ayakta mı? Bağımlılıklara bakmaz; yeniden başlatma kararı için.
  app.get('/health/live', () => ({ status: 'ok' }));

  // Trafik alabilir miyiz? Bağımlılıkları kontrol eder.
  app.get('/health/ready', async (_request, reply) => {
    try {
      await deps.checkDatabase();
      return { status: 'ok' };
    } catch (error) {
      app.log.error({ err: error }, 'readiness kontrolü başarısız');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
