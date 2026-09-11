import {
  adminOverrideDeliveryInput,
  assignTripCrewInput,
  assignTripVehicleInput,
  cloneRouteVersionInput,
  createStudentTripMoveInput,
  commitImportInput,
  createGuardianInput,
  createHolidayInput,
  createInviteInput,
  createRouteInput,
  createSchoolInput,
  createStaffInput,
  createStopInput,
  createStudentInput,
  createVehicleInput,
  changeUnactivatedPhoneInput,
  endStudentInput,
  listTripsQuery,
  pinAddressInput,
  previewImportInput,
  replaceRouteStopsInput,
} from '@servisapp/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireTenantId } from '../../auth/context.js';
import type { AppData } from '../../data/ports.js';
import { badRequest, forbidden, notFound } from '../../http-error.js';

const studentIdParams = z.object({ studentId: z.uuid() });
const schoolIdParams = z.object({ schoolId: z.uuid() });
const routeIdParams = z.object({ routeId: z.uuid() });
const versionIdParams = z.object({ versionId: z.uuid() });

function tenantIdOf(request: FastifyRequest): string {
  return requireTenantId(request.auth);
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('invalid_body', result.error.issues[0]?.message ?? 'Geçersiz istek');
  }
  return result.data;
}

function todayIstanbul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

function adminActor(request: FastifyRequest) {
  const membership = request.auth?.membership;
  if (!membership) throw forbidden();
  return {
    membershipId: membership.membershipId,
    roles: membership.roles,
    deviceId: null as string | null,
    platform: 'ANDROID' as const,
    appVersion: null as string | null,
  };
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

  app.post('/v1/admin/schools/:schoolId/calendar-days', async (request) => {
    const params = parse(schoolIdParams, request.params);
    const input = parse(createHolidayInput, request.body);
    return data.admin.createHoliday(tenantIdOf(request), params.schoolId, input);
  });

  app.get('/v1/admin/staff', async (request) => {
    return { items: await data.admin.listStaff(tenantIdOf(request)) };
  });

  app.get('/v1/admin/students/:studentId', async (request) => {
    const params = parse(studentIdParams, request.params);
    const item = await data.admin.getStudent(tenantIdOf(request), params.studentId);
    if (!item) throw notFound('Öğrenci bulunamadı');
    return item;
  });

  app.post('/v1/admin/students/:studentId/end', async (request) => {
    const params = parse(studentIdParams, request.params);
    const input = parse(endStudentInput, request.body);
    return data.admin.endStudent(tenantIdOf(request), params.studentId, input.enrollmentEnd);
  });

  app.post('/v1/admin/students/:studentId/guardians/:membershipId/revoke', async (request) => {
    const params = parse(
      z.object({ studentId: z.uuid(), membershipId: z.uuid() }),
      request.params,
    );
    return data.admin.revokeGuardian(tenantIdOf(request), params.studentId, params.membershipId);
  });

  app.post('/v1/admin/identities/:identityId/phone', async (request) => {
    const params = parse(z.object({ identityId: z.uuid() }), request.params);
    const input = parse(changeUnactivatedPhoneInput, request.body);
    return data.admin.changeUnactivatedPhone(tenantIdOf(request), params.identityId, input.phone);
  });

  app.post('/v1/admin/imports/preview', async (request) => {
    const input = parse(previewImportInput, request.body);
    const membershipId = request.auth?.membership?.membershipId ?? '';
    return data.admin.previewImport(tenantIdOf(request), membershipId, input);
  });

  app.get('/v1/admin/imports/:batchId', async (request) => {
    const params = parse(z.object({ batchId: z.uuid() }), request.params);
    const batch = await data.admin.getImport(tenantIdOf(request), params.batchId);
    if (!batch) throw notFound('İçe aktarma bulunamadı');
    return batch;
  });

  app.post('/v1/admin/imports/:batchId/commit', async (request) => {
    const params = parse(z.object({ batchId: z.uuid() }), request.params);
    const input = parse(commitImportInput, request.body ?? {});
    return data.admin.commitImport(tenantIdOf(request), params.batchId, input);
  });

  app.post('/v1/admin/invites', async (request) => {
    const input = parse(createInviteInput, request.body);
    const actorId = request.auth?.membership?.membershipId ?? '';
    return data.admin.createInvite(tenantIdOf(request), actorId, input.membershipId);
  });

  app.post('/v1/admin/invites/:inviteId/sms', async (request) => {
    const params = parse(z.object({ inviteId: z.uuid() }), request.params);
    return data.admin.sendInviteSms(tenantIdOf(request), params.inviteId);
  });

  app.get('/v1/admin/trips', async (request) => {
    const query = parse(listTripsQuery, request.query);
    const membership = request.auth?.membership;
    if (!membership) throw notFound('Sefer bulunamadı');
    return {
      items: await data.admin.listTripsForDate(
        tenantIdOf(request),
        {
          membershipId: membership.membershipId,
          roles: membership.roles,
          deviceId: null,
          platform: 'ANDROID',
          appVersion: null,
        },
        query.date,
      ),
    };
  });

  app.get('/v1/admin/trips/:tripId', async (request) => {
    const params = parse(z.object({ tripId: z.uuid() }), request.params);
    const membership = request.auth?.membership;
    if (!membership) throw notFound('Sefer bulunamadı');
    const detail = await data.admin.getTripDetail(
      tenantIdOf(request),
      {
        membershipId: membership.membershipId,
        roles: membership.roles,
        deviceId: null,
        platform: 'ANDROID',
        appVersion: null,
      },
      params.tripId,
    );
    if (!detail) throw notFound('Sefer bulunamadı');
    return detail;
  });

  app.post('/v1/admin/trips/:tripId/vehicle', async (request) => {
    const params = parse(z.object({ tripId: z.uuid() }), request.params);
    const input = parse(assignTripVehicleInput, request.body);
    return data.admin.assignTripVehicle(tenantIdOf(request), adminActor(request), params.tripId, input);
  });

  app.post('/v1/admin/trips/:tripId/crew', async (request) => {
    const params = parse(z.object({ tripId: z.uuid() }), request.params);
    const input = parse(assignTripCrewInput, request.body);
    return data.admin.assignTripCrew(tenantIdOf(request), adminActor(request), params.tripId, input);
  });

  app.post('/v1/admin/trip-moves', async (request) => {
    const input = parse(createStudentTripMoveInput, request.body);
    return data.admin.transferStudent(tenantIdOf(request), adminActor(request), input);
  });

  app.get('/v1/admin/events', async (request) => {
    const membershipId = request.auth?.membership?.membershipId;
    if (!membershipId) throw forbidden();
    const query = parse(listTripsQuery.partial(), request.query);
    return data.admin.listEvents(tenantIdOf(request), membershipId, query.date ?? todayIstanbul());
  });

  app.get('/v1/admin/priorities', async (request) => {
    const membershipId = request.auth?.membership?.membershipId;
    if (!membershipId) throw forbidden();
    const query = parse(listTripsQuery.partial(), request.query);
    return data.admin.listPriorities(
      tenantIdOf(request),
      membershipId,
      query.date ?? todayIstanbul(),
    );
  });
  app.get('/v1/admin/exceptions', async (request) => {
    const membershipId = request.auth?.membership?.membershipId;
    if (!membershipId) throw forbidden();
    return data.admin.listExceptions(tenantIdOf(request), membershipId);
  });

  app.post('/v1/admin/delivery-overrides/:overrideId/approve', async (request) => {
    const membershipId = request.auth?.membership?.membershipId;
    if (!membershipId) throw forbidden();
    const params = parse(z.object({ overrideId: z.uuid() }), request.params);
    return data.admin.approveDeliveryOverride(tenantIdOf(request), membershipId, params.overrideId);
  });

  app.post('/v1/admin/delivery-overrides/:overrideId/reject', async (request) => {
    const membershipId = request.auth?.membership?.membershipId;
    if (!membershipId) throw forbidden();
    const params = parse(z.object({ overrideId: z.uuid() }), request.params);
    return data.admin.rejectDeliveryOverride(tenantIdOf(request), membershipId, params.overrideId);
  });

  app.post('/v1/admin/delivery-overrides/:overrideId/admin-verify', async (request) => {
    const membershipId = request.auth?.membership?.membershipId;
    if (!membershipId) throw forbidden();
    const params = parse(z.object({ overrideId: z.uuid() }), request.params);
    const input = parse(adminOverrideDeliveryInput, request.body);
    return data.admin.adminOverrideDelivery(
      tenantIdOf(request),
      membershipId,
      params.overrideId,
      input,
    );
  });

  app.post('/v1/admin/address-changes/:requestId/approve', async (request) => {
    const membershipId = request.auth?.membership?.membershipId;
    if (!membershipId) throw forbidden();
    const params = parse(z.object({ requestId: z.uuid() }), request.params);
    return data.admin.approveAddressChange(tenantIdOf(request), membershipId, params.requestId);
  });

  app.post('/v1/admin/address-changes/:requestId/reject', async (request) => {
    const membershipId = request.auth?.membership?.membershipId;
    if (!membershipId) throw forbidden();
    const params = parse(z.object({ requestId: z.uuid() }), request.params);
    return data.admin.rejectAddressChange(tenantIdOf(request), membershipId, params.requestId);
  });
}
