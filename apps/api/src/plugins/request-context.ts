import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** İstemciden gelen kimliği aynen loglamadan önce daraltıyoruz (log enjeksiyonu). */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Fastify'ın kendi `reqId`'si bizim istek kimliğimiz olur; böylece "incoming
 * request" ve "request completed" dahil HER log satırı aynı kimliği taşır.
 * Bir velinin "servis gelmedi" iddiası tek `reqId` ile uçtan uca izlenebilir
 * (SPEC §12).
 */
export function generateRequestId(req: IncomingMessage): string {
  const header = req.headers['x-request-id'];
  return typeof header === 'string' && SAFE_ID.test(header) ? header : randomUUID();
}

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    done();
  });
}
