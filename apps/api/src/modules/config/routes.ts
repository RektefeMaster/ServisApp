import type { FastifyInstance } from 'fastify';
import type { AppData } from '../../data/ports.js';

export function registerConfigRoutes(app: FastifyInstance, data: AppData): void {
  app.get('/v1/config', () => data.getPlatform());
}
