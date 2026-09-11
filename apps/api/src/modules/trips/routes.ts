import {
  ackCriticalChangeInput,
  cancelTripInput,
  generateTripsInput,
  listTripsQuery,
  locationPingInput,
  recordVehicleCheckInput,
  reportIncidentInput,
  studentCommandInput,
  undoStudentCommandInput,
  verifyDeliveryOtpInput,
} from '@servisapp/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireTenantId } from '../../auth/context.js';
import type { AppData, TripActor } from '../../data/ports.js';
import { badRequest, forbidden, notFound } from '../../http-error.js';

const tripIdParams = z.object({ tripId: z.uuid() });
const alertParams = z.object({ tripId: z.uuid(), alertId: z.uuid() });
const devicePlatform = z.enum(['IOS', 'ANDROID']);

function tenantIdOf(request: FastifyRequest): string {
  return requireTenantId(request.auth);
}

function requireCrewOrAdmin(request: FastifyRequest): void {
  const roles = request.auth?.membership?.roles ?? [];
  if (roles.includes('ADMIN') || roles.includes('DRIVER') || roles.includes('ATTENDANT')) return;
  throw forbidden();
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

function actorOf(
  request: FastifyRequest,
  device: 'required' | 'admin-optional' = 'required',
): TripActor {
  requireCrewOrAdmin(request);
  const membership = request.auth?.membership;
  if (!membership) throw forbidden();
  const deviceId = headerString(
    request.headers['x-device-id'],
    'invalid_device',
    'x-device-id geçersiz',
  );
  if (!deviceId) {
    if (device === 'admin-optional' && membership.roles.includes('ADMIN')) {
      return {
        membershipId: membership.membershipId,
        roles: membership.roles,
        deviceId: null,
        platform: 'ANDROID',
        appVersion: null,
      };
    }
    throw badRequest('device_required', 'x-device-id zorunlu');
  }
  const parsedDevice = z.uuid().safeParse(deviceId);
  if (!parsedDevice.success) throw badRequest('invalid_device', 'x-device-id UUID olmalı');
  const platformRaw = headerString(
    request.headers['x-device-platform'],
    'invalid_platform',
    'x-device-platform geçersiz',
  );
  const platform = devicePlatform.safeParse(platformRaw ?? 'ANDROID');
  if (!platform.success) throw badRequest('invalid_platform', 'x-device-platform IOS|ANDROID');
  const appVersion = headerString(
    request.headers['x-app-version'],
    'invalid_app_version',
    'x-app-version geçersiz',
  );
  return {
    membershipId: membership.membershipId,
    roles: membership.roles,
    deviceId: parsedDevice.data,
    platform: platform.data,
    appVersion: appVersion ?? null,
  };
}

function listActorOf(request: FastifyRequest): TripActor {
  requireCrewOrAdmin(request);
  const membership = request.auth?.membership;
  if (!membership) throw forbidden();
  return {
    membershipId: membership.membershipId,
    roles: membership.roles,
    deviceId: null,
    platform: 'ANDROID',
    appVersion: null,
  };
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('invalid_body', result.error.issues[0]?.message ?? 'Geçersiz istek');
  }
  return result.data;
}

export function registerTripRoutes(app: FastifyInstance, data: AppData): void {
  app.get('/v1/trips', async (request) => {
    const query = parse(listTripsQuery, request.query);
    return {
      items: await data.trips.listForDate(tenantIdOf(request), listActorOf(request), query.date),
    };
  });

  app.get('/v1/trips/:tripId', async (request) => {
    const params = parse(tripIdParams, request.params);
    const detail = await data.trips.getDetail(
      tenantIdOf(request),
      listActorOf(request),
      params.tripId,
    );
    if (!detail) throw notFound('Sefer bulunamadı');
    return detail;
  });

  app.post('/v1/trips/:tripId/vehicle-checks', async (request) => {
    const params = parse(tripIdParams, request.params);
    const input = parse(recordVehicleCheckInput, request.body);
    return data.trips.recordVehicleCheck(
      tenantIdOf(request),
      actorOf(request),
      params.tripId,
      input,
    );
  });

  app.post('/v1/trips/:tripId/start', async (request) => {
    const params = parse(tripIdParams, request.params);
    return data.trips.startTrip(tenantIdOf(request), actorOf(request), params.tripId);
  });

  app.post('/v1/trips/:tripId/complete', async (request) => {
    const params = parse(tripIdParams, request.params);
    return data.trips.completeTrip(tenantIdOf(request), actorOf(request), params.tripId);
  });

  app.post('/v1/trips/:tripId/cancel', async (request) => {
    const params = parse(tripIdParams, request.params);
    const input = parse(cancelTripInput, request.body);
    return data.trips.cancelTrip(
      tenantIdOf(request),
      actorOf(request, 'admin-optional'),
      params.tripId,
      input,
    );
  });

  app.post('/v1/trips/:tripId/commands', async (request) => {
    const params = parse(tripIdParams, request.params);
    const input = parse(studentCommandInput, request.body);
    return data.trips.applyStudentCommand(
      tenantIdOf(request),
      actorOf(request),
      params.tripId,
      input,
    );
  });

  app.post('/v1/trips/:tripId/commands/undo', async (request) => {
    const params = parse(tripIdParams, request.params);
    const input = parse(undoStudentCommandInput, request.body);
    return data.trips.undoStudentCommand(
      tenantIdOf(request),
      actorOf(request),
      params.tripId,
      input,
    );
  });

  app.post('/v1/trips/:tripId/incidents', async (request) => {
    const params = parse(tripIdParams, request.params);
    const input = parse(reportIncidentInput, request.body);
    return data.trips.reportIncident(
      tenantIdOf(request),
      actorOf(request),
      params.tripId,
      input,
    );
  });

  app.post('/v1/trips/:tripId/location', async (request) => {
    const params = parse(tripIdParams, request.params);
    const input = parse(locationPingInput, request.body);
    return data.trips.ingestLocation(
      tenantIdOf(request),
      actorOf(request),
      params.tripId,
      input,
    );
  });

  app.post('/v1/trips/:tripId/otp/verify', async (request) => {
    const params = parse(tripIdParams, request.params);
    const input = parse(verifyDeliveryOtpInput, request.body);
    return data.trips.verifyDeliveryOtp(
      tenantIdOf(request),
      actorOf(request),
      params.tripId,
      input,
    );
  });

  app.post('/v1/trips/:tripId/alerts/:alertId/ack', async (request) => {
    const params = parse(alertParams, request.params);
    parse(ackCriticalChangeInput, { alertId: params.alertId });
    return data.trips.ackCriticalChange(
      tenantIdOf(request),
      actorOf(request),
      params.tripId,
      params.alertId,
    );
  });
}

export function registerTripAdminRoutes(app: FastifyInstance, data: AppData): void {
  app.post('/v1/admin/trips/generate', async (request) => {
    const membershipId = request.auth?.membership?.membershipId;
    if (!membershipId) throw forbidden();
    const input = parse(generateTripsInput, request.body ?? {});
    return data.admin.generateHorizon(tenantIdOf(request), membershipId, input);
  });
}
