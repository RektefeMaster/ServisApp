import {
  activateInviteInput,
  createAddressChangeInput,
  createDeliveryOverrideInput,
  createRideExceptionInput,
  parentDayQuery,
} from '@servisapp/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireTenantId } from '../../auth/context.js';
import type { AppData } from '../../data/ports.js';
import { badRequest, forbidden, notFound, unauthorized } from '../../http-error.js';

const tokenParams = z.object({ token: z.string().min(16).max(200) });
const tripIdParams = z.object({ tripId: z.uuid() });
const studentIdParams = z.object({ studentId: z.uuid() });
const exceptionIdParams = z.object({ exceptionId: z.uuid() });
const overrideIdParams = z.object({ overrideId: z.uuid() });
const trackingQuery = z.object({ studentId: z.uuid().optional() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('invalid_body', result.error.issues[0]?.message ?? 'Geçersiz istek');
  }
  return result.data;
}

function tenantIdOf(request: FastifyRequest): string {
  return requireTenantId(request.auth);
}

function requireGuardian(request: FastifyRequest): { membershipId: string } {
  const auth = request.auth;
  if (!auth?.membership) throw forbidden();
  if (auth.membership.status !== 'ACTIVE') throw forbidden();
  if (!auth.membership.roles.includes('GUARDIAN')) throw forbidden();
  return { membershipId: auth.membership.membershipId };
}

export function registerParentRoutes(app: FastifyInstance, data: AppData): void {
  app.get('/v1/invites/:token', async (request) => {
    const params = parse(tokenParams, request.params);
    const preview = await data.parent.previewInvite(params.token);
    if (!preview) throw notFound('Davet bulunamadı');
    return preview;
  });

  app.post('/v1/parent/invites/activate', async (request) => {
    const auth = request.auth;
    if (!auth) throw unauthorized();
    const input = parse(activateInviteInput, request.body);
    return data.parent.activateInvite(input.token, {
      authUserId: auth.authUserId,
      identityId: auth.identityId,
      phone: auth.phone,
    });
  });

  app.get('/v1/parent/children', async (request) => {
    const { membershipId } = requireGuardian(request);
    return {
      items: await data.parent.listChildren(tenantIdOf(request), membershipId),
    };
  });

  app.get('/v1/parent/home', async (request) => {
    const { membershipId } = requireGuardian(request);
    return data.parent.getHome(tenantIdOf(request), membershipId);
  });

  app.get('/v1/parent/trips/:tripId/tracking', async (request) => {
    const { membershipId } = requireGuardian(request);
    const params = parse(tripIdParams, request.params);
    const query = parse(trackingQuery, request.query);
    return data.parent.pollTracking(
      tenantIdOf(request),
      membershipId,
      params.tripId,
      query.studentId,
    );
  });

  app.get('/v1/parent/students/:studentId/day', async (request) => {
    const { membershipId } = requireGuardian(request);
    const params = parse(studentIdParams, request.params);
    const query = parse(parentDayQuery, request.query);
    return data.parent.getParentDayPlan(
      tenantIdOf(request),
      membershipId,
      params.studentId,
      query.date,
    );
  });

  app.post('/v1/parent/exceptions', async (request) => {
    const { membershipId } = requireGuardian(request);
    const input = parse(createRideExceptionInput, request.body);
    return data.parent.createRideException(tenantIdOf(request), membershipId, input);
  });

  app.post('/v1/parent/exceptions/:exceptionId/cancel', async (request) => {
    const { membershipId } = requireGuardian(request);
    const params = parse(exceptionIdParams, request.params);
    return data.parent.cancelRideException(tenantIdOf(request), membershipId, params.exceptionId);
  });

  app.post('/v1/parent/delivery-overrides', async (request) => {
    const { membershipId } = requireGuardian(request);
    const input = parse(createDeliveryOverrideInput, request.body);
    return data.parent.createDeliveryOverride(tenantIdOf(request), membershipId, input);
  });

  app.post('/v1/parent/delivery-overrides/:overrideId/cancel', async (request) => {
    const { membershipId } = requireGuardian(request);
    const params = parse(overrideIdParams, request.params);
    return data.parent.cancelDeliveryOverride(tenantIdOf(request), membershipId, params.overrideId);
  });

  app.post('/v1/parent/delivery-overrides/:overrideId/resend', async (request) => {
    const { membershipId } = requireGuardian(request);
    const params = parse(overrideIdParams, request.params);
    return data.parent.resendDeliveryOtp(tenantIdOf(request), membershipId, params.overrideId);
  });

  app.post('/v1/parent/address-changes', async (request) => {
    const { membershipId } = requireGuardian(request);
    const input = parse(createAddressChangeInput, request.body);
    return data.parent.createAddressChange(tenantIdOf(request), membershipId, input);
  });
}
