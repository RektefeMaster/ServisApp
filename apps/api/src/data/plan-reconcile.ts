import {
  criticalChangeAck,
  criticalChangeAlert,
  deliveryOverride,
  event,
  trip,
  tripStop,
  tripStudent,
  type Database,
} from '@servisapp/db';
import {
  criticalAlertAutoDropped,
  deliveryTargetForSegment,
  type StudentState,
  type TripState,
} from '@servisapp/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { HttpError } from '../http-error.js';
import { firstRow, jsonObject } from './sql-result.js';

const OPEN_TRIP_STATES = ['PLANNED', 'READY', 'ACTIVE'] as const;

export interface OpenTripStudent {
  tripStudentId: string;
  tripId: string;
  tripState: TripState;
  segment: 'MORNING' | 'AFTERNOON';
  studentState: StudentState;
  stateSeq: number;
  deliveryTarget: 'SCHOOL' | 'HOME' | 'TEMP';
  expectedStopId: string | null;
  vehicleId: string;
}

export async function applyTripStudentPlan(
  tx: Database,
  input: {
    tripStudentId: string;
    state?: StudentState;
    deliveryTarget?: 'SCHOOL' | 'HOME' | 'TEMP';
    needsReview?: boolean;
    receiverName?: string | null;
    dropoff?: { lat: number; lng: number; text: string };
  },
): Promise<{ applied: boolean; reason: string; state: string; stateSeq: number; tripState: string }> {
  const row = firstRow(
    await tx.execute(sql`
      select apply_trip_student_plan(
        ${input.tripStudentId}::uuid,
        ${input.state !== undefined}::boolean,
        ${input.state ?? 'EXPECTED'}::student_state,
        ${input.deliveryTarget !== undefined}::boolean,
        ${input.deliveryTarget ?? 'HOME'}::delivery_target,
        ${input.needsReview !== undefined}::boolean,
        ${input.needsReview ?? false}::boolean,
        ${input.receiverName !== undefined}::boolean,
        ${input.receiverName ?? null}::text,
        ${input.dropoff !== undefined}::boolean,
        ${input.dropoff?.lat ?? null}::double precision,
        ${input.dropoff?.lng ?? null}::double precision,
        ${input.dropoff?.text ?? null}::text
      ) as result
    `),
  );
  const result = jsonObject(row?.['result']);
  if (!result) throw new HttpError(500, 'plan_failed', 'Plan katmanı uygulanamadı');
  return {
    applied: result['applied'] === true,
    reason: typeof result['reason'] === 'string' ? result['reason'] : '',
    state: typeof result['state'] === 'string' ? result['state'] : '',
    stateSeq: Number(result['stateSeq'] ?? 0),
    tripState: typeof result['tripState'] === 'string' ? result['tripState'] : '',
  };
}

export async function findOpenTripStudents(
  tx: Database,
  tenantId: string,
  studentId: string,
  serviceDate: string,
  segment?: 'MORNING' | 'AFTERNOON',
): Promise<OpenTripStudent[]> {
  const rows = await tx
    .select({
      tripStudentId: tripStudent.id,
      tripId: trip.id,
      tripState: trip.state,
      segment: trip.segment,
      studentState: tripStudent.state,
      stateSeq: tripStudent.stateSeq,
      deliveryTarget: tripStudent.deliveryTarget,
      expectedStopId: tripStudent.expectedStopId,
      vehicleId: trip.currentVehicleId,
    })
    .from(tripStudent)
    .innerJoin(trip, and(eq(trip.id, tripStudent.tripId), eq(trip.tenantId, tenantId)))
    .where(
      and(
        eq(tripStudent.tenantId, tenantId),
        eq(tripStudent.studentId, studentId),
        eq(trip.serviceDate, serviceDate),
        inArray(trip.state, [...OPEN_TRIP_STATES]),
        ...(segment ? [eq(trip.segment, segment)] : []),
      ),
    );
  return rows.map((row) => ({
    tripStudentId: row.tripStudentId,
    tripId: row.tripId,
    tripState: row.tripState as TripState,
    segment: row.segment,
    studentState: row.studentState as StudentState,
    stateSeq: row.stateSeq,
    deliveryTarget: row.deliveryTarget,
    expectedStopId: row.expectedStopId,
    vehicleId: row.vehicleId,
  }));
}

export async function insertPlanEvent(
  tx: Database,
  input: {
    tenantId: string;
    membershipId: string | null;
    role: 'ADMIN' | 'GUARDIAN' | 'DRIVER' | 'ATTENDANT' | 'SYSTEM';
    tripId: string;
    vehicleId: string;
    subjectType: string;
    subjectId: string;
    eventType: string;
    prevState: string | null;
    newState: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(event).values({
    tenantId: input.tenantId,
    actorMembershipId: input.role === 'SYSTEM' || !input.membershipId ? null : input.membershipId,
    actorRole: input.role,
    deviceId: null,
    vehicleId: input.vehicleId,
    tripId: input.tripId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    eventType: input.eventType,
    prevState: input.prevState,
    newState: input.newState,
    payload: input.payload ?? {},
  });
}

export async function raiseCriticalAlert(
  tx: Database,
  input: {
    tenantId: string;
    tripId: string;
    body: string;
    stopId: string | null;
  },
): Promise<void> {
  await tx.insert(criticalChangeAlert).values({
    tenantId: input.tenantId,
    tripId: input.tripId,
    severity: 'CRITICAL',
    body: input.body,
    requiresAckRoles: ['DRIVER', 'ATTENDANT'],
    tripStopId: input.stopId,
  });
}

export type PendingAlert = {
  id: string;
  tripId: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  stopId: string | null;
  requiresAck: boolean;
};

export async function listPendingAlerts(
  tx: Database,
  tenantId: string,
  tripId: string,
  membershipId: string,
  roles: string[],
): Promise<PendingAlert[]> {
  const rows = await tx
    .select({
      id: criticalChangeAlert.id,
      tripId: criticalChangeAlert.tripId,
      body: criticalChangeAlert.body,
      severity: criticalChangeAlert.severity,
      stopId: criticalChangeAlert.tripStopId,
      requiresAckRoles: criticalChangeAlert.requiresAckRoles,
      tripState: trip.state,
      arrivedAt: tripStop.actualArrivedAt,
    })
    .from(criticalChangeAlert)
    .innerJoin(trip, and(eq(trip.id, criticalChangeAlert.tripId), eq(trip.tenantId, tenantId)))
    .leftJoin(
      tripStop,
      and(eq(tripStop.id, criticalChangeAlert.tripStopId), eq(tripStop.tenantId, tenantId)),
    )
    .where(and(eq(criticalChangeAlert.tenantId, tenantId), eq(criticalChangeAlert.tripId, tripId)));

  const acks = await tx
    .select({ alertId: criticalChangeAck.alertId })
    .from(criticalChangeAck)
    .where(and(eq(criticalChangeAck.tenantId, tenantId), eq(criticalChangeAck.membershipId, membershipId)));
  const acked = new Set(acks.map((row) => row.alertId));
  const isAdmin = roles.includes('ADMIN');

  return rows
    .filter((row) => {
      if (acked.has(row.id)) return false;
      const required = row.requiresAckRoles ?? [];
      if (!isAdmin && required.length > 0 && !required.some((role) => roles.includes(role))) {
        return false;
      }
      const tripState = row.tripState as Parameters<typeof criticalAlertAutoDropped>[0]['tripState'];
      return !criticalAlertAutoDropped({
        tripState,
        stopArrivedAt: row.arrivedAt,
      });
    })
    .map((row) => ({
      id: row.id,
      tripId: row.tripId,
      body: row.body,
      severity: row.severity,
      stopId: row.stopId,
      requiresAck: true,
    }));
}

export async function listBlockingAlerts(
  tx: Database,
  tenantId: string,
  tripId: string,
  membershipId: string,
  roles: string[],
): Promise<PendingAlert[]> {
  if (roles.includes('ADMIN')) return [];
  return listPendingAlerts(tx, tenantId, tripId, membershipId, roles);
}

export async function cancelActiveOverrides(
  tx: Database,
  tenantId: string,
  studentId: string,
  serviceDate: string,
  options?: { raiseAlert?: boolean },
): Promise<void> {
  const rows = await tx
    .select({ id: deliveryOverride.id })
    .from(deliveryOverride)
    .where(
      and(
        eq(deliveryOverride.tenantId, tenantId),
        eq(deliveryOverride.studentId, studentId),
        eq(deliveryOverride.serviceDate, serviceDate),
        inArray(deliveryOverride.status, ['PENDING_APPROVAL', 'ACTIVE', 'LOCKED']),
      ),
    );
  if (rows.length === 0) return;
  await tx
    .update(deliveryOverride)
    .set({ status: 'CANCELLED', otpCiphertext: null })
    .where(
      inArray(
        deliveryOverride.id,
        rows.map((row) => row.id),
      ),
    );
  const open = await findOpenTripStudents(tx, tenantId, studentId, serviceDate, 'AFTERNOON');
  for (const item of open) {
    if (item.deliveryTarget !== 'TEMP') continue;
    let dropoff: { lat: number; lng: number; text: string } | undefined;
    if (item.expectedStopId) {
      const [stop] = await tx
        .select({
          lat: tripStop.snapshotLat,
          lng: tripStop.snapshotLng,
          text: tripStop.snapshotAddressText,
        })
        .from(tripStop)
        .where(and(eq(tripStop.id, item.expectedStopId), eq(tripStop.tenantId, tenantId)));
      if (stop) dropoff = { lat: stop.lat, lng: stop.lng, text: stop.text };
    }
    await applyTripStudentPlan(tx, {
      tripStudentId: item.tripStudentId,
      deliveryTarget: deliveryTargetForSegment(item.segment),
      receiverName: null,
      dropoff,
    });
    if (options?.raiseAlert && item.tripState === 'ACTIVE') {
      await raiseCriticalAlert(tx, {
        tenantId,
        tripId: item.tripId,
        stopId: item.expectedStopId,
        body: 'Farklı teslimat iptal; ev adresine bırakılacak',
      });
    }
  }
}
