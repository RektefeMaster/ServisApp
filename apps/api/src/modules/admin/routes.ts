import {
  cloneRouteVersionInput,
  createGuardianInput,
  createRouteInput,
  createSchoolInput,
  createStaffInput,
  createStopInput,
  createStudentInput,
  createVehicleInput,
  pinAddressInput,
  replaceRouteStopsInput,
} from '@servisapp/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppData } from '../../data/ports.js';
import { badRequest, notFound } from '../../http-error.js';

const studentIdParams = z.object({ studentId: z.uuid() });
const routeIdParams = z.object({ routeId: z.uuid() });
const versionIdParams = z.object({ versionId: z.uuid() });

function tenantIdOf(request: FastifyRequest): string {
  const id = request.auth?.membership?.tenantId;
  if (!id) throw badRequest('tenant_required', 'x-tenant-id zorunlu');
  return id;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('invalid_body', result.error.issues[0]?.message ?? 'Geçersiz istek');
  }
  return result.data;
}

export function registerAdminRoutes(app: FastifyInstance, data: AppData): void {
  app.get('/v1/admin/addresses', async (request) => {
    return { items: await data.admin.listAddresses(tenantIdOf(request)) };
  });

  app.post('/v1/admin/addresses', async (request) => {
    const input = parse(pinAddressInput, request.body);
    return data.admin.pinAddress(tenantIdOf(request), input);
  });

  app.get('/v1/admin/schools', async (request) => {
    return { items: await data.admin.listSchools(tenantIdOf(request)) };
  });

  app.post('/v1/admin/schools', async (request) => {
    const input = parse(createSchoolInput, request.body);
    return data.admin.createSchool(tenantIdOf(request), input);
  });

  app.get('/v1/admin/vehicles', async (request) => {
    return { items: await data.admin.listVehicles(tenantIdOf(request)) };
  });

  app.post('/v1/admin/vehicles', async (request) => {
    const input = parse(createVehicleInput, request.body);
    return data.admin.createVehicle(tenantIdOf(request), input);
  });

  app.post('/v1/admin/staff', async (request) => {
    const input = parse(createStaffInput, request.body);
    const membershipId = request.auth?.membership?.membershipId ?? '';
    return data.admin.createStaff(tenantIdOf(request), membershipId, input);
  });

  app.get('/v1/admin/students', async (request) => {
    return { items: await data.admin.listStudents(tenantIdOf(request)) };
  });

  app.post('/v1/admin/students', async (request) => {
    const input = parse(createStudentInput, request.body);
    return data.admin.createStudent(tenantIdOf(request), input);
  });

  app.post('/v1/admin/students/:studentId/guardians', async (request) => {
    const params = parse(studentIdParams, request.params);
    const input = parse(createGuardianInput, request.body);
    return data.admin.createGuardian(tenantIdOf(request), params.studentId, input);
  });

  app.get('/v1/admin/stops', async (request) => {
    return { items: await data.admin.listStops(tenantIdOf(request)) };
  });

  app.post('/v1/admin/stops', async (request) => {
    const input = parse(createStopInput, request.body);
    return data.admin.createStop(tenantIdOf(request), input);
  });

  app.get('/v1/admin/routes', async (request) => {
    return { items: await data.admin.listRoutes(tenantIdOf(request)) };
  });

  app.post('/v1/admin/routes', async (request) => {
    const input = parse(createRouteInput, request.body);
    return data.admin.createRoute(tenantIdOf(request), input);
  });

  app.get('/v1/admin/routes/:routeId', async (request) => {
    const params = parse(routeIdParams, request.params);
    const detail = await data.admin.getRoute(tenantIdOf(request), params.routeId);
    if (!detail) throw notFound('Rota bulunamadı');
    return detail;
  });

  app.post('/v1/admin/routes/:routeId/versions', async (request) => {
    const params = parse(routeIdParams, request.params);
    const input = parse(cloneRouteVersionInput, request.body ?? {});
    return data.admin.cloneRouteVersion(tenantIdOf(request), params.routeId, input);
  });

  app.get('/v1/admin/route-versions/:versionId', async (request) => {
    const params = parse(versionIdParams, request.params);
    const view = await data.admin.getRouteVersion(tenantIdOf(request), params.versionId);
    if (!view) throw notFound('Rota sürümü bulunamadı');
    return view;
  });

  app.put('/v1/admin/route-versions/:versionId/stops', async (request) => {
    const params = parse(versionIdParams, request.params);
    const input = parse(replaceRouteStopsInput, request.body);
    return data.admin.replaceRouteStops(tenantIdOf(request), params.versionId, input);
  });

  app.post('/v1/admin/route-versions/:versionId/suggest-order', async (request) => {
    const params = parse(versionIdParams, request.params);
    return data.admin.suggestRouteStopOrder(tenantIdOf(request), params.versionId);
  });

  app.post('/v1/admin/route-versions/:versionId/publish', async (request) => {
    const params = parse(versionIdParams, request.params);
    return data.admin.publishRouteVersion(tenantIdOf(request), params.versionId);
  });
}
