import type {
  CancelTripInput,
  GenerateTripsInput,
  ReportIncidentInput,
  StudentCommandInput,
} from '@servisapp/contracts';
import {
  address,
  commandReceipt,
  device,
  deliveryOverride,
  event,
  identity,
  rideException,
  route,
  routeStop,
  routeStopStudent,
  school,
  schoolCalendarDay,
  staffAssignment,
  stop,
  student,
  studentGuardian,
  studentTripMove,
  tenant,
  tenantMembership,
  trip,
  tripCrewAssignment,
  tripStop,
  tripStopStudent,
  tripStudent,
  tripVehicleAssignment,
  tripVehicleCheck,
  vehicle,
  vehicleCurrentLocation,
  withTenant,
  type Database,
} from '@servisapp/db';
import {
  applyStudentAction,
  canTransitionTrip,
  tripReadyCrewBlock,
  deliveryTargetForSegment,
  expectedStopKind,
  gpsWatchdog,
  pickStudentAnchorStop,
  horizonDatesFrom,
  occupiesVehicle,
  plannedDepartureAt,
  TRIP_STATES,
  ymdInTimeZone,
  zonedDayEnd,
  zonedDayStart,
  type ActorRole,
  type StudentState,
  type TripState,
} from '@servisapp/domain';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http-error.js';
import { isUniqueViolation, mapDbError } from './db-error.js';
import {
  loadHorizonRouteVersions,
  pickApplicableRouteVersions,
} from './applicable-route-versions.js';
import { listBlockingAlerts, listPendingAlerts } from './plan-reconcile.js';
import { assertTripResourcesIdle } from './operations.js';
import type {
  CommandResult,
  GenerateHorizonResult,
  TripActor,
  TripDetail,
  TripPort,
  TripStopView,
  TripStudentView,
  TripSummary,
} from './ports.js';
import { studentHomePoints } from './student-home.js';
import { writeHaversineBaseline } from './tracking.js';
import { firstRow, isRecord, jsonObject } from './sql-result.js';

export function createTripPort(
  db: Database,
  hooks: {
    onClosed?: (tripId: string) => void;
    ingest?: TripPort['ingestLocation'];
  } = {},
): Omit<TripPort, 'verifyDeliveryOtp' | 'ackCriticalChange'> {
  return {
    generateHorizon(tenantId, actor, input) {
      return withTrip(db, tenantId, actor.membershipId, actor.role, (tx) =>
        generateHorizonTx(tx, tenantId, input),
      );
    },

    listForDate(tenantId, actor, date) {
      return withTrip(db, tenantId, actor.membershipId, actorRoleOf(actor), (tx) =>
        listForDateTx(tx, tenantId, actor, date),
      );
    },

    getDetail(tenantId, actor, tripId) {
      return withTrip(db, tenantId, actor.membershipId, actorRoleOf(actor), (tx) =>
        getDetailTx(tx, tenantId, actor, tripId),
      );
    },

    recordVehicleCheck(tenantId, actor, tripId, input) {
      return withTrip(db, tenantId, actor.membershipId, actorRoleOf(actor), async (tx) => {
        await ensureDevice(tx, tenantId, actor);
        await lockTrip(tx, tenantId, tripId);
        const row = await attachMissingAttendant(
          tx,
          tenantId,
          await loadTripForActor(tx, tenantId, actor, tripId),
        );
        if (input.phase === 'BEFORE' && row.state !== 'PLANNED' && row.state !== 'READY') {
          throw conflict('trip_not_awaiting_start', 'Sefer bu aşamada araç kontrolü alamaz');
        }
        if (input.phase === 'AFTER' && row.state !== 'ACTIVE') {
          throw conflict('trip_not_active', 'Sefer sonu kontrolü yalnız aktif seferde');
        }
        if (input.phase === 'AFTER') {
          const occupants = await tx
            .select({ state: tripStudent.state })
            .from(tripStudent)
            .where(and(eq(tripStudent.tripId, tripId), eq(tripStudent.tenantId, tenantId)));
          if (occupants.some((item) => occupiesVehicle(item.state))) {
            throw conflict(
              'vehicle_not_empty',
              'Araçta öğrenci varken sefer sonu boş kontrolü yapılamaz',
            );
          }
        }
        const inserted = await tx
          .insert(tripVehicleCheck)
          .values({
            tenantId,
            tripId,
            phase: input.phase,
            checkedBy: actor.membershipId,
            vehicleEmptyConfirmed: true,
          })
          .onConflictDoNothing({
            target: [tripVehicleCheck.tenantId, tripVehicleCheck.tripId, tripVehicleCheck.phase],
          })
          .returning({ id: tripVehicleCheck.id });
        if (inserted.length === 0) {
          if (input.phase === 'AFTER') {
            const revived = await reviveAfterCheck(tx, tenantId, tripId, actor.membershipId);
            if (revived) {
              await insertEvent(tx, {
                tenantId,
                actor,
                tripId,
                vehicleId: row.vehicleId,
                subjectType: 'TRIP',
                subjectId: tripId,
                eventType: 'VEHICLE_CHECK_AFTER',
                prevState: row.state,
                newState: row.state,
              });
            }
          }
          const next = await loadTripSummary(tx, tenantId, tripId);
          if (!next) throw notFound('Sefer bulunamadı');
          return next;
        }
        if (input.phase === 'BEFORE' && row.state === 'PLANNED') {
          await assertTripReadyCrew(tx, tenantId, row);
          await assertTripResourcesIdle(tx, {
            tenantId,
            tripId,
            serviceDate: dateOnly(row.serviceDate),
            vehicleId: row.vehicleId,
            membershipIds: [row.driverId, row.attendantId],
          });
          await updateTripWhereState(tx, tenantId, tripId, 'PLANNED', { state: 'READY' });
          await insertEvent(tx, {
            tenantId,
            actor,
            tripId,
            vehicleId: row.vehicleId,
            subjectType: 'TRIP',
            subjectId: tripId,
            eventType: 'TRIP_READY',
            prevState: 'PLANNED',
            newState: 'READY',
          });
        }
        await insertEvent(tx, {
          tenantId,
          actor,
          tripId,
          vehicleId: row.vehicleId,
          subjectType: 'TRIP',
          subjectId: tripId,
          eventType: input.phase === 'BEFORE' ? 'VEHICLE_CHECK_BEFORE' : 'VEHICLE_CHECK_AFTER',
          prevState: row.state,
          newState: input.phase === 'BEFORE' && row.state === 'PLANNED' ? 'READY' : row.state,
        });
        const next = await loadTripSummary(tx, tenantId, tripId);
        if (!next) throw notFound('Sefer bulunamadı');
        return next;
      });
    },

    startTrip(tenantId, actor, tripId) {
      return withTrip(db, tenantId, actor.membershipId, actorRoleOf(actor), async (tx) => {
        await ensureDevice(tx, tenantId, actor);
        await lockTrip(tx, tenantId, tripId);
        const row = await attachMissingAttendant(
          tx,
          tenantId,
          await loadTripForActor(tx, tenantId, actor, tripId),
        );
        const before = await hasCheck(tx, tenantId, tripId, 'BEFORE');
        const currentState = row.state as TripState;
        if (currentState !== 'PLANNED' && currentState !== 'READY') {
          const early = canTransitionTrip({
            from: currentState,
            to: 'ACTIVE',
            actorRole: actorRoleOf(actor),
            vehicleSweepConfirmed: true,
            studentStates: [],
          });
          if (!early.ok) throw tripDecisionError(early.reason);
        }
        if (!before) {
          throw conflict('vehicle_sweep_not_confirmed', 'Sefer öncesi araç boş kontrolü yok');
        }
        if (row.state === 'PLANNED') {
          await assertTripReadyCrew(tx, tenantId, row);
          await assertTripResourcesIdle(tx, {
            tenantId,
            tripId,
            serviceDate: dateOnly(row.serviceDate),
            vehicleId: row.vehicleId,
            membershipIds: [row.driverId, row.attendantId],
          });
          await updateTripWhereState(tx, tenantId, tripId, 'PLANNED', { state: 'READY' });
          await insertEvent(tx, {
            tenantId,
            actor,
            tripId,
            vehicleId: row.vehicleId,
            subjectType: 'TRIP',
            subjectId: tripId,
            eventType: 'TRIP_READY',
            prevState: 'PLANNED',
            newState: 'READY',
          });
          row.state = 'READY';
        }
        await assertTripReadyCrew(tx, tenantId, row);
        await assertTripResourcesIdle(tx, {
          tenantId,
          tripId,
          serviceDate: dateOnly(row.serviceDate),
          vehicleId: row.vehicleId,
          membershipIds: [row.driverId, row.attendantId],
        });
        const decision = canTransitionTrip({
          from: row.state as TripState,
          to: 'ACTIVE',
          actorRole: actorRoleOf(actor),
          vehicleSweepConfirmed: true,
          studentStates: [],
        });
        if (!decision.ok) throw tripDecisionError(decision.reason);
        await updateTripWhereState(tx, tenantId, tripId, row.state as TripState, {
          state: 'ACTIVE',
          actualStartedAt: new Date(),
          locationSourceDeviceId: requireDeviceId(actor),
          locationSessionEpoch: row.locationSessionEpoch + 1,
        });
        await insertEvent(tx, {
          tenantId,
          actor,
          tripId,
          vehicleId: row.vehicleId,
          subjectType: 'TRIP',
          subjectId: tripId,
          eventType: 'TRIP_STARTED',
          prevState: row.state,
          newState: 'ACTIVE',
        });
        const next = await loadTripSummary(tx, tenantId, tripId);
        if (!next) throw notFound('Sefer bulunamadı');
        await writeHaversineBaseline(tx, tenantId, tripId);
        return next;
      });
    },

    completeTrip(tenantId, actor, tripId) {
      return withTrip(db, tenantId, actor.membershipId, actorRoleOf(actor), async (tx) => {
        await ensureDevice(tx, tenantId, actor);
        await lockTrip(tx, tenantId, tripId);
        const row = await loadTripForActor(tx, tenantId, actor, tripId);
        const students = await tx
          .select({ state: tripStudent.state })
          .from(tripStudent)
          .where(and(eq(tripStudent.tripId, tripId), eq(tripStudent.tenantId, tenantId)));
        const after = await hasCheck(tx, tenantId, tripId, 'AFTER');
        const decision = canTransitionTrip({
          from: row.state as TripState,
          to: 'COMPLETED',
          actorRole: actorRoleOf(actor),
          vehicleSweepConfirmed: after,
          studentStates: students.map((item) => item.state),
        });
        if (!decision.ok) throw tripDecisionError(decision.reason);
        await tx.execute(sql`select complete_trip(${tripId}::uuid)`);
        await insertEvent(tx, {
          tenantId,
          actor,
          tripId,
          vehicleId: row.vehicleId,
          subjectType: 'TRIP',
          subjectId: tripId,
          eventType: 'TRIP_COMPLETED',
          prevState: row.state,
          newState: 'COMPLETED',
        });
        const next = await loadTripSummary(tx, tenantId, tripId);
        if (!next) throw notFound('Sefer bulunamadı');
        hooks.onClosed?.(tripId);
        return next;
      });
    },

    cancelTrip(tenantId, actor, tripId, input: CancelTripInput) {
      return withTrip(db, tenantId, actor.membershipId, actorRoleOf(actor), async (tx) => {
        if (!actor.roles.includes('ADMIN')) throw forbidden();
        if (actor.deviceId) await ensureDevice(tx, tenantId, actor);
        await lockTrip(tx, tenantId, tripId);
        const row = await loadTripForActor(tx, tenantId, actor, tripId);
        const students = await tx
          .select({ state: tripStudent.state })
          .from(tripStudent)
          .where(and(eq(tripStudent.tripId, tripId), eq(tripStudent.tenantId, tenantId)));
        const decision = canTransitionTrip({
          from: row.state as TripState,
          to: 'CANCELLED',
          actorRole: 'ADMIN',
          vehicleSweepConfirmed: true,
          studentStates: students.map((item) => item.state),
        });
        if (!decision.ok) throw tripDecisionError(decision.reason);
        await updateTripWhereState(tx, tenantId, tripId, row.state as TripState, {
          state: 'CANCELLED',
          cancelReason: input.reason,
        });
        await insertEvent(tx, {
          tenantId,
          actor,
          tripId,
          vehicleId: row.vehicleId,
          subjectType: 'TRIP',
          subjectId: tripId,
          eventType: 'TRIP_CANCELLED',
          prevState: row.state,
          newState: 'CANCELLED',
          skipDevice: !actor.deviceId,
        });
        const next = await loadTripSummary(tx, tenantId, tripId);
        if (!next) throw notFound('Sefer bulunamadı');
        hooks.onClosed?.(tripId);
        return next;
      });
    },

    applyStudentCommand(tenantId, actor, tripId, input: StudentCommandInput) {
      return withTrip(db, tenantId, actor.membershipId, actorRoleOf(actor), async (tx) => {
        await ensureDevice(tx, tenantId, actor);
        await lockTrip(tx, tenantId, tripId);
        await loadTripForActor(tx, tenantId, actor, tripId);
        const blocked = await listBlockingAlerts(
          tx,
          tenantId,
          tripId,
          actor.membershipId,
          actor.roles,
        );
        if (blocked.length > 0) {
          return {
            replay: false,
            status: 'REJECTED' as const,
            tripStudentId: input.tripStudentId,
            state: '',
            stateSeq: 0,
            reason: 'CRITICAL_CHANGE_UNACKED',
          };
        }
        const receipt = await beginReceipt(tx, tenantId, actor, input);
        if (receipt) return receipt;

        const locked = await lockStudent(tx, input.tripStudentId);
        if (locked.tripId !== tripId) {
          const body: CommandResult = {
            replay: false,
            status: 'REJECTED',
            tripStudentId: input.tripStudentId,
            state: '',
            stateSeq: 0,
            reason: 'TRIP_MISMATCH',
          };
          await finishReceipt(tx, tenantId, input.clientEventId, body);
          return body;
        }

        if (locked.stateSeq !== input.expectedStateSeq) {
          const applied = await applyLockedTransition(tx, {
            tripStudentId: input.tripStudentId,
            expectedStateSeq: input.expectedStateSeq,
            from: locked.state,
            to: locked.state,
          });
          const body: CommandResult = {
            replay: false,
            status: 'CONFLICT',
            tripStudentId: input.tripStudentId,
            state: applied.state,
            stateSeq: applied.stateSeq,
            reason: 'STUDENT_STATE_CONFLICT',
          };
          await insertEvent(tx, {
            tenantId,
            actor,
            tripId,
            vehicleId: locked.vehicleId,
            subjectType: 'TRIP_STUDENT',
            subjectId: input.tripStudentId,
            eventType: 'STUDENT_STATE_CONFLICT',
            prevState: locked.state,
            newState: locked.state,
            lat: input.lat,
            lng: input.lng,
            occurredAtDevice: input.occurredAtDevice,
            sourceCommandId: input.clientEventId,
          });
          await finishReceipt(tx, tenantId, input.clientEventId, body);
          return body;
        }

        const domain = applyStudentAction({
          action: input.action,
          currentState: locked.state,
          tripState: locked.tripState,
          actorRole: actorRoleOf(actor),
          deliveryTarget: locked.deliveryTarget,
          deliveryVerified: locked.deliveryVerified,
        });
        if (!domain.ok) {
          const body: CommandResult = {
            replay: false,
            status: 'REJECTED',
            tripStudentId: input.tripStudentId,
            state: locked.state,
            stateSeq: locked.stateSeq,
            reason: domain.reason,
          };
          await finishReceipt(tx, tenantId, input.clientEventId, body);
          return body;
        }

        const applied = await applyLockedTransition(tx, {
          tripStudentId: input.tripStudentId,
          expectedStateSeq: input.expectedStateSeq,
          from: locked.state,
          to: domain.nextState,
          boardedLat: input.lat,
          boardedLng: input.lng,
        });
        if (!applied.applied) {
          const body: CommandResult = {
            replay: false,
            status: 'CONFLICT',
            tripStudentId: input.tripStudentId,
            state: applied.state,
            stateSeq: applied.stateSeq,
            reason: 'STUDENT_STATE_CONFLICT',
          };
          await insertEvent(tx, {
            tenantId,
            actor,
            tripId,
            vehicleId: locked.vehicleId,
            subjectType: 'TRIP_STUDENT',
            subjectId: input.tripStudentId,
            eventType: 'STUDENT_STATE_CONFLICT',
            prevState: locked.state,
            newState: locked.state,
            lat: input.lat,
            lng: input.lng,
            occurredAtDevice: input.occurredAtDevice,
            sourceCommandId: input.clientEventId,
          });
          await finishReceipt(tx, tenantId, input.clientEventId, body);
          return body;
        }

        const body: CommandResult = {
          replay: false,
          status: 'APPLIED',
          tripStudentId: input.tripStudentId,
          state: applied.state,
          stateSeq: applied.stateSeq,
        };
        await insertEvent(tx, {
          tenantId,
          actor,
          tripId,
          vehicleId: locked.vehicleId,
          subjectType: 'TRIP_STUDENT',
          subjectId: input.tripStudentId,
          eventType: 'STUDENT_STATE',
          prevState: locked.state,
          newState: domain.nextState,
          lat: input.lat,
          lng: input.lng,
          occurredAtDevice: input.occurredAtDevice,
          sourceCommandId: input.clientEventId,
        });
        await finishReceipt(tx, tenantId, input.clientEventId, body);
        return body;
      });
    },

    reportIncident(tenantId, actor, tripId, input: ReportIncidentInput) {
      return withTrip(db, tenantId, actor.membershipId, actorRoleOf(actor), async (tx) => {
        await ensureDevice(tx, tenantId, actor);
        const row = await loadTripForActor(tx, tenantId, actor, tripId);
        let subjectType = 'TRIP';
        let subjectId = tripId;
        if (input.studentId) {
          const [onTrip] = await tx
            .select({ id: tripStudent.id })
            .from(tripStudent)
            .where(
              and(
                eq(tripStudent.tenantId, tenantId),
                eq(tripStudent.tripId, tripId),
                eq(tripStudent.studentId, input.studentId),
              ),
            );
          if (!onTrip) throw notFound('Öğrenci bu seferde yok');
          subjectType = 'TRIP_STUDENT';
          subjectId = onTrip.id;
        }
        await insertEvent(tx, {
          tenantId,
          actor,
          tripId,
          vehicleId: row.vehicleId,
          subjectType,
          subjectId,
          eventType: 'CREW_INCIDENT',
          prevState: row.state,
          newState: row.state,
          payload: { body: input.body, studentId: input.studentId ?? null },
        });
        return { ok: true as const };
      });
    },

    ingestLocation(tenantId, actor, tripId, input) {
      if (!hooks.ingest) {
        throw new HttpError(500, 'tracking_unbound', 'Konum katmanı bağlı değil');
      }
      return hooks.ingest(tenantId, actor, tripId, input);
    },
  };
}

async function generateHorizonTx(
  tx: Database,
  tenantId: string,
  input: GenerateTripsInput,
): Promise<GenerateHorizonResult> {
  const [tenantRow] = await tx
    .select({ timezone: tenant.timezone })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!tenantRow) throw notFound('Şirket bulunamadı');
  const timezone = tenantRow.timezone;
  const fromDate = input.fromDate ?? ymdInTimeZone(new Date(), timezone);
  const dates = horizonDatesFrom(fromDate, input.days);

  const versions = await loadHorizonRouteVersions(tx, tenantId);

  const tripIds: string[] = [];
  let skipped = 0;
  for (const date of dates) {
    const applicable = pickApplicableRouteVersions(versions, date);
    for (const item of applicable) {
      await tx.execute(sql`savepoint gen_one`);
      try {
        const created = await generateOne(tx, {
          tenantId,
          timezone,
          serviceDate: date,
          route: item,
        });
        if (created) tripIds.push(created);
        else skipped += 1;
      } catch (error) {
        await tx.execute(sql`rollback to savepoint gen_one`);
        if (
          isUniqueViolation(error, 'trip_route_date') ||
          isUniqueViolation(error, 'service_date')
        ) {
          skipped += 1;
        } else {
          throw error;
        }
      } finally {
        await tx.execute(sql`release savepoint gen_one`);
      }
    }
  }
  return { created: tripIds.length, skipped, tripIds };
}

interface PublishedRoute {
  routeId: string;
  vehicleId: string;
  schoolId: string;
  segment: 'MORNING' | 'AFTERNOON';
  versionId: string;
  effectiveFrom: string | Date;
  maxDetourM: number;
}

async function generateOne(
  tx: Database,
  input: {
    tenantId: string;
    timezone: string;
    serviceDate: string;
    route: PublishedRoute;
  },
): Promise<string | null> {
  const { tenantId, timezone, serviceDate: day } = input;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:${input.route.routeId}`}), hashtext(${day}))`,
  );
  const [existing] = await tx
    .select({ id: trip.id })
    .from(trip)
    .where(
      and(
        eq(trip.tenantId, tenantId),
        eq(trip.routeId, input.route.routeId),
        eq(trip.serviceDate, day),
      ),
    );
  if (existing) {
    return null;
  }

  const [holiday] = await tx
    .select({ date: schoolCalendarDay.date })
    .from(schoolCalendarDay)
    .where(
      and(
        eq(schoolCalendarDay.tenantId, tenantId),
        eq(schoolCalendarDay.schoolId, input.route.schoolId),
        eq(schoolCalendarDay.date, day),
        eq(schoolCalendarDay.type, 'HOLIDAY'),
      ),
    );
  if (holiday) return null;

  const dayStart = zonedDayStart(day, timezone);
  const dayEnd = zonedDayEnd(day, timezone);
  const driverId = await assignedCrew(
    tx,
    tenantId,
    input.route.vehicleId,
    'DRIVER',
    dayStart,
    dayEnd,
  );
  const attendantId = await assignedCrew(
    tx,
    tenantId,
    input.route.vehicleId,
    'ATTENDANT',
    dayStart,
    dayEnd,
  );

  const stopRows = await tx
    .select({
      routeStopId: routeStop.id,
      stopId: routeStop.stopId,
      seq: routeStop.seq,
      kind: routeStop.kind,
      lat: stop.lat,
      lng: stop.lng,
      label: stop.label,
      addressText: address.text,
    })
    .from(routeStop)
    .innerJoin(stop, and(eq(stop.id, routeStop.stopId), eq(stop.tenantId, tenantId)))
    .innerJoin(address, and(eq(address.id, stop.addressId), eq(address.tenantId, tenantId)))
    .where(
      and(eq(routeStop.routeVersionId, input.route.versionId), eq(routeStop.tenantId, tenantId)),
    )
    .orderBy(asc(routeStop.seq));
  if (stopRows.length === 0) return null;

  const stopIds = stopRows.map((row) => row.routeStopId);
  const assigned = await tx
    .select({
      routeStopId: routeStopStudent.routeStopId,
      studentId: routeStopStudent.studentId,
      enrollmentStart: student.enrollmentStart,
      enrollmentEnd: student.enrollmentEnd,
      usesMorning: student.usesMorning,
      usesEvening: student.usesEvening,
      suspended: student.suspended,
    })
    .from(routeStopStudent)
    .innerJoin(
      student,
      and(eq(student.id, routeStopStudent.studentId), eq(student.tenantId, tenantId)),
    )
    .where(
      and(eq(routeStopStudent.tenantId, tenantId), inArray(routeStopStudent.routeStopId, stopIds)),
    );

  const moves = await tx
    .select({
      studentId: studentTripMove.studentId,
      targetRouteId: studentTripMove.targetRouteId,
    })
    .from(studentTripMove)
    .where(
      and(
        eq(studentTripMove.tenantId, tenantId),
        eq(studentTripMove.serviceDate, day),
        eq(studentTripMove.segment, input.route.segment),
      ),
    );
  const exceptions = await tx
    .select({ studentId: rideException.studentId })
    .from(rideException)
    .where(
      and(
        eq(rideException.tenantId, tenantId),
        eq(rideException.serviceDate, day),
        eq(rideException.segment, input.route.segment),
        isNull(rideException.cancelledAt),
      ),
    );

  const exceptionSet = new Set(exceptions.map((row) => row.studentId));
  const moveOut = new Set(
    moves.filter((row) => row.targetRouteId !== input.route.routeId).map((row) => row.studentId),
  );
  const moveInIds = [
    ...new Set(
      moves.filter((row) => row.targetRouteId === input.route.routeId).map((row) => row.studentId),
    ),
  ];

  type Planned = {
    studentId: string;
    origin: 'FROM_ROUTE' | 'MOVED_IN';
    state: StudentState;
    routeStopIds: string[];
  };
  const planned = new Map<string, Planned>();
  for (const row of assigned) {
    if (dateOnly(row.enrollmentStart) > day) continue;
    if (row.enrollmentEnd && dateOnly(row.enrollmentEnd) < day) continue;
    if (row.suspended) continue;
    if (!studentUsesSegment(input.route.segment, row)) continue;
    let state: StudentState = 'EXPECTED';
    if (moveOut.has(row.studentId)) state = 'MOVED_OUT';
    else if (exceptionSet.has(row.studentId)) state = 'ABSENT_PLANNED';
    const existing = planned.get(row.studentId);
    if (existing) {
      existing.routeStopIds.push(row.routeStopId);
      continue;
    }
    planned.set(row.studentId, {
      studentId: row.studentId,
      origin: 'FROM_ROUTE',
      state,
      routeStopIds: [row.routeStopId],
    });
  }
  for (const studentId of await enrolledMoveIns(
    tx,
    tenantId,
    day,
    input.route.segment,
    moveInIds,
  )) {
    if (planned.has(studentId)) continue;
    planned.set(studentId, {
      studentId,
      origin: 'MOVED_IN',
      state: exceptionSet.has(studentId) ? 'ABSENT_PLANNED' : 'EXPECTED',
      routeStopIds: [],
    });
  }
  if (planned.size === 0) return null;

  // ACTIVE farklı teslimat yalnız akşam seferine TEMP olarak yazılır. Override
  // id korumalı kolondur; INSERT'te yalnız hedef + alıcı + snapshot gider.
  const overrideSnaps = new Map<
    string,
    { receiverName: string; lat: number; lng: number; text: string }
  >();
  if (input.route.segment === 'AFTERNOON') {
    const activeOverrides = await tx
      .select({
        studentId: deliveryOverride.studentId,
        receiverName: deliveryOverride.receiverName,
        lat: address.lat,
        lng: address.lng,
        text: address.text,
      })
      .from(deliveryOverride)
      .innerJoin(
        address,
        and(eq(address.id, deliveryOverride.addressId), eq(address.tenantId, tenantId)),
      )
      .where(
        and(
          eq(deliveryOverride.tenantId, tenantId),
          eq(deliveryOverride.serviceDate, day),
          eq(deliveryOverride.status, 'ACTIVE'),
          inArray(deliveryOverride.studentId, [...planned.keys()]),
        ),
      );
    for (const row of activeOverrides) {
      overrideSnaps.set(row.studentId, {
        receiverName: row.receiverName,
        lat: row.lat,
        lng: row.lng,
        text: row.text,
      });
    }
  }

  const departure = plannedDepartureAt(day, input.route.segment, timezone);
  const [created] = await tx
    .insert(trip)
    .values({
      tenantId,
      routeId: input.route.routeId,
      routeVersionId: input.route.versionId,
      serviceDate: day,
      segment: input.route.segment,
      state: 'PLANNED',
      plannedDepartureAt: departure,
      currentVehicleId: input.route.vehicleId,
      currentDriverMembershipId: driverId,
      currentAttendantMembershipId: attendantId,
    })
    .returning({ id: trip.id });
  if (!created) throw new HttpError(500, 'insert_failed', 'Sefer üretilemedi');

  await tx.insert(tripVehicleAssignment).values({
    tenantId,
    tripId: created.id,
    vehicleId: input.route.vehicleId,
    validFrom: dayStart,
  });
  if (driverId) {
    await tx.insert(tripCrewAssignment).values({
      tenantId,
      tripId: created.id,
      membershipId: driverId,
      role: 'DRIVER',
      validFrom: dayStart,
    });
  }
  if (attendantId) {
    await tx.insert(tripCrewAssignment).values({
      tenantId,
      tripId: created.id,
      membershipId: attendantId,
      role: 'ATTENDANT',
      validFrom: dayStart,
    });
  }

  const tripStopByRouteStop = new Map<string, string>();
  let schoolTripStopId: string | null = null;
  let firstPickupTripStopId: string | null = null;
  let lastDropoffTripStopId: string | null = null;
  let schoolSnap: { lat: number; lng: number; text: string } | null = null;
  for (const row of stopRows) {
    const [inserted] = await tx
      .insert(tripStop)
      .values({
        tenantId,
        tripId: created.id,
        seq: String(row.seq),
        kind: row.kind,
        sourceStopId: row.stopId,
        snapshotLat: row.lat,
        snapshotLng: row.lng,
        snapshotLabel: row.label,
        snapshotAddressText: row.addressText,
      })
      .returning({ id: tripStop.id });
    if (!inserted) throw new HttpError(500, 'insert_failed', 'Sefer durağı kopyalanamadı');
    tripStopByRouteStop.set(row.routeStopId, inserted.id);
    if (row.kind === 'SCHOOL') {
      schoolTripStopId = inserted.id;
      schoolSnap = { lat: row.lat, lng: row.lng, text: row.addressText };
    }
    if (row.kind === 'PICKUP' && firstPickupTripStopId === null) {
      firstPickupTripStopId = inserted.id;
    }
    if (row.kind === 'DROPOFF') lastDropoffTripStopId = inserted.id;
  }

  const expectKind = expectedStopKind(input.route.segment);
  const target = deliveryTargetForSegment(input.route.segment);
  const kindByRouteStop = new Map(stopRows.map((row) => [row.routeStopId, row.kind]));
  const moveInHomes = await studentHomePoints(
    tx,
    tenantId,
    [...planned.values()]
      .filter((item) => item.origin === 'MOVED_IN')
      .map((item) => item.studentId),
    day,
    input.route.segment,
  );

  for (const item of planned.values()) {
    const linkedTripStopIds: string[] = [];
    for (const routeStopId of item.routeStopIds) {
      const tripStopId = tripStopByRouteStop.get(routeStopId);
      if (!tripStopId) continue;
      linkedTripStopIds.push(tripStopId);
      await tx.insert(tripStopStudent).values({
        tenantId,
        tripStopId,
        studentId: item.studentId,
      });
    }
    let expectedId: string | null;
    let stopSnap:
      | { lat: number; lng: number; addressText: string }
      | undefined;
    if (item.origin === 'MOVED_IN') {
      const home = moveInHomes.get(item.studentId) ?? null;
      const picked = pickStudentAnchorStop(
        stopRows.map((row) => ({
          routeStopId: row.routeStopId,
          kind: row.kind,
          lat: row.lat,
          lng: row.lng,
        })),
        home,
        input.route.segment,
      );
      if (!picked) {
        throw new HttpError(
          409,
          home ? 'stop_not_on_route' : 'student_address_missing',
          home
            ? 'Transfer öğrencisinin adresi hedef rotada durakla eşleşmiyor'
            : 'Transfer öğrencisinin adresi yok',
        );
      }
      expectedId = tripStopByRouteStop.get(picked.routeStopId) ?? null;
      if (expectedId && !linkedTripStopIds.includes(expectedId)) {
        await tx.insert(tripStopStudent).values({
          tenantId,
          tripStopId: expectedId,
          studentId: item.studentId,
        });
      }
      const pickedRow = stopRows.find((row) => row.routeStopId === picked.routeStopId);
      if (pickedRow) {
        stopSnap = { lat: pickedRow.lat, lng: pickedRow.lng, addressText: pickedRow.addressText };
      }
    } else {
      const preferredRouteStopId =
        item.routeStopIds.find((id) => kindByRouteStop.get(id) === expectKind) ??
        item.routeStopIds[0] ??
        null;
      expectedId = preferredRouteStopId
        ? (tripStopByRouteStop.get(preferredRouteStopId) ?? null)
        : expectKind === 'DROPOFF'
          ? (lastDropoffTripStopId ?? schoolTripStopId)
          : (firstPickupTripStopId ?? schoolTripStopId);
      const preferred = preferredRouteStopId
        ? stopRows.find((row) => row.routeStopId === preferredRouteStopId)
        : undefined;
      if (preferred) {
        stopSnap = { lat: preferred.lat, lng: preferred.lng, addressText: preferred.addressText };
      } else if (input.route.segment === 'AFTERNOON') {
        const last = stopRows.find(
          (row) => tripStopByRouteStop.get(row.routeStopId) === lastDropoffTripStopId,
        );
        if (last) stopSnap = { lat: last.lat, lng: last.lng, addressText: last.addressText };
      }
    }
    const dropoff =
      input.route.segment === 'MORNING'
        ? schoolSnap
        : stopSnap
          ? { lat: stopSnap.lat, lng: stopSnap.lng, text: stopSnap.addressText }
          : schoolSnap;
    const override = overrideSnaps.get(item.studentId);
    const useTemp =
      Boolean(override) && item.state !== 'ABSENT_PLANNED' && item.state !== 'MOVED_OUT';
    const tempSnap = useTemp && override ? override : null;
    await tx.insert(tripStudent).values({
      tenantId,
      tripId: created.id,
      studentId: item.studentId,
      state: item.state,
      deliveryTarget: tempSnap ? 'TEMP' : target,
      expectedStopId: expectedId,
      snapshotDropoffLat: tempSnap?.lat ?? dropoff?.lat,
      snapshotDropoffLng: tempSnap?.lng ?? dropoff?.lng,
      snapshotDropoffText: tempSnap?.text ?? dropoff?.text,
      receiverName: tempSnap?.receiverName ?? null,
      origin: item.origin,
    });
  }

  await insertEvent(tx, {
    tenantId,
    actor: {
      membershipId: '',
      roles: ['ADMIN'],
      deviceId: null,
      platform: 'ANDROID',
      appVersion: null,
    },
    tripId: created.id,
    vehicleId: input.route.vehicleId,
    subjectType: 'TRIP',
    subjectId: created.id,
    eventType: 'TRIP_GENERATED',
    prevState: null,
    newState: 'PLANNED',
    actorRoleOverride: 'SYSTEM',
    skipDevice: true,
  });
  return created.id;
}

async function assignedCrew(
  tx: Database,
  tenantId: string,
  vehicleId: string,
  role: 'DRIVER' | 'ATTENDANT',
  dayStart: Date,
  dayEnd: Date,
): Promise<string | null> {
  const rows = await tx
    .select({ membershipId: staffAssignment.membershipId })
    .from(staffAssignment)
    .innerJoin(
      tenantMembership,
      and(
        eq(tenantMembership.id, staffAssignment.membershipId),
        eq(tenantMembership.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(staffAssignment.tenantId, tenantId),
        eq(staffAssignment.vehicleId, vehicleId),
        eq(staffAssignment.role, role),
        lt(staffAssignment.validFrom, dayEnd),
        or(isNull(staffAssignment.validTo), gt(staffAssignment.validTo, dayStart)),
        inArray(tenantMembership.status, ['ACTIVE', 'INVITED']),
      ),
    )
    .orderBy(
      sql`case when ${tenantMembership.status} = 'ACTIVE' then 0 else 1 end`,
      desc(staffAssignment.validFrom),
    )
    .limit(1);
  return rows[0]?.membershipId ?? null;
}

async function enrolledMoveIns(
  tx: Database,
  tenantId: string,
  day: string,
  segment: 'MORNING' | 'AFTERNOON',
  studentIds: string[],
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const rows = await tx
    .select({
      id: student.id,
      enrollmentStart: student.enrollmentStart,
      enrollmentEnd: student.enrollmentEnd,
      usesMorning: student.usesMorning,
      usesEvening: student.usesEvening,
      suspended: student.suspended,
    })
    .from(student)
    .where(and(eq(student.tenantId, tenantId), inArray(student.id, studentIds)));
  const enrolled: string[] = [];
  for (const row of rows) {
    if (dateOnly(row.enrollmentStart) > day) continue;
    if (row.enrollmentEnd && dateOnly(row.enrollmentEnd) < day) continue;
    if (row.suspended) continue;
    if (!studentUsesSegment(segment, row)) continue;
    enrolled.push(row.id);
  }
  return enrolled;
}

async function listForDateTx(
  tx: Database,
  tenantId: string,
  actor: TripActor,
  date: string,
): Promise<TripSummary[]> {
  const rows = await tx
    .select({
      id: trip.id,
      routeId: trip.routeId,
      serviceDate: trip.serviceDate,
      segment: trip.segment,
      state: trip.state,
      plannedDepartureAt: trip.plannedDepartureAt,
      vehicleId: trip.currentVehicleId,
      plate: vehicle.plate,
      schoolName: school.name,
    })
    .from(trip)
    .innerJoin(route, and(eq(route.id, trip.routeId), eq(route.tenantId, tenantId)))
    .innerJoin(vehicle, and(eq(vehicle.id, trip.currentVehicleId), eq(vehicle.tenantId, tenantId)))
    .innerJoin(school, and(eq(school.id, route.schoolId), eq(school.tenantId, tenantId)))
    .where(and(eq(trip.tenantId, tenantId), eq(trip.serviceDate, date)))
    .orderBy(asc(trip.plannedDepartureAt));
  const summaries = rows.map(toSummary);
  if (actor.roles.includes('ADMIN')) return summaries;
  const allowed = await assignedTripIds(
    tx,
    tenantId,
    actor.membershipId,
    rows.map((row) => row.id),
  );
  return summaries.filter((item) => allowed.has(item.id));
}

async function getDetailTx(
  tx: Database,
  tenantId: string,
  actor: TripActor,
  tripId: string,
): Promise<TripDetail | null> {
  const header = await loadTripForActor(tx, tenantId, actor, tripId);
  const checks = {
    before: await hasCheck(tx, tenantId, tripId, 'BEFORE'),
    after: await hasCheck(tx, tenantId, tripId, 'AFTER'),
  };
  const stopRows = await tx
    .select({
      id: tripStop.id,
      seq: tripStop.seq,
      kind: tripStop.kind,
      label: tripStop.snapshotLabel,
      lat: tripStop.snapshotLat,
      lng: tripStop.snapshotLng,
      addressText: tripStop.snapshotAddressText,
    })
    .from(tripStop)
    .where(and(eq(tripStop.tripId, tripId), eq(tripStop.tenantId, tenantId)))
    .orderBy(asc(tripStop.seq));
  const stopPk = stopRows.map((row) => row.id);
  const links =
    stopPk.length === 0
      ? []
      : await tx
          .select({
            tripStopId: tripStopStudent.tripStopId,
            studentId: tripStopStudent.studentId,
          })
          .from(tripStopStudent)
          .where(
            and(
              eq(tripStopStudent.tenantId, tenantId),
              inArray(tripStopStudent.tripStopId, stopPk),
            ),
          );
  const byStop = new Map<string, string[]>();
  for (const row of links) {
    const list = byStop.get(row.tripStopId) ?? [];
    list.push(row.studentId);
    byStop.set(row.tripStopId, list);
  }
  const studentRows = await tx
    .select({
      id: tripStudent.id,
      studentId: tripStudent.studentId,
      fullName: student.fullName,
      photoPath: student.photoPath,
      state: tripStudent.state,
      stateSeq: tripStudent.stateSeq,
      deliveryTarget: tripStudent.deliveryTarget,
      expectedStopId: tripStudent.expectedStopId,
      needsReview: tripStudent.needsReview,
      deliveryVerifiedAt: tripStudent.deliveryVerifiedAt,
      snapshotDropoffText: tripStudent.snapshotDropoffText,
      receiverName: tripStudent.receiverName,
    })
    .from(tripStudent)
    .innerJoin(student, and(eq(student.id, tripStudent.studentId), eq(student.tenantId, tenantId)))
    .where(and(eq(tripStudent.tripId, tripId), eq(tripStudent.tenantId, tenantId)))
    .orderBy(asc(student.fullName));

  const stops: TripStopView[] = stopRows.map((row) => ({
    id: row.id,
    seq: Number(row.seq),
    kind: row.kind,
    label: row.label,
    lat: row.lat,
    lng: row.lng,
    addressText: row.addressText,
    studentIds: byStop.get(row.id) ?? [],
  }));
  const stopLabel = new Map(stops.map((row) => [row.id, row.label]));
  const guardians = await loadCrewGuardians(
    tx,
    tenantId,
    studentRows.map((row) => row.studentId),
  );
  const students: TripStudentView[] = studentRows.map((row) => {
    const guardian = guardians.get(row.studentId);
    return {
      id: row.id,
      studentId: row.studentId,
      fullName: row.fullName,
      state: row.state,
      stateSeq: row.stateSeq,
      deliveryTarget: row.deliveryTarget,
      expectedStopId: row.expectedStopId,
      expectedStopLabel: row.expectedStopId ? (stopLabel.get(row.expectedStopId) ?? null) : null,
      needsReview: row.needsReview,
      photoPath: row.photoPath,
      guardianPhone: guardian?.phone ?? null,
      guardianName: guardian?.name ?? null,
      deliveryVerified: row.deliveryVerifiedAt !== null,
      snapshotDropoffText: row.snapshotDropoffText,
      receiverName: row.receiverName,
    };
  });
  const [liveRow] = await tx
    .select({
      lat: vehicleCurrentLocation.lat,
      lng: vehicleCurrentLocation.lng,
      heading: vehicleCurrentLocation.heading,
      recordedAt: vehicleCurrentLocation.recordedAt,
      quality: vehicleCurrentLocation.quality,
      isStale: vehicleCurrentLocation.isStale,
      sessionEpoch: vehicleCurrentLocation.sessionEpoch,
    })
    .from(vehicleCurrentLocation)
    .where(
      and(
        eq(vehicleCurrentLocation.tenantId, tenantId),
        eq(vehicleCurrentLocation.vehicleId, header.vehicleId),
        eq(vehicleCurrentLocation.tripId, tripId),
        eq(vehicleCurrentLocation.sessionEpoch, header.locationSessionEpoch),
      ),
    );
  const watchdog = liveRow ? gpsWatchdog(Date.now() - liveRow.recordedAt.getTime()) : 'UNAVAILABLE';
  const live =
    liveRow && liveRow.quality !== 'REJECTED'
      ? {
          lat: liveRow.lat,
          lng: liveRow.lng,
          heading: liveRow.heading,
          recordedAt: instantIso(liveRow.recordedAt),
          quality: liveRow.quality === 'LOW' ? ('LOW' as const) : ('GOOD' as const),
          isStale: watchdog !== 'LIVE',
        }
      : null;
  const pendingAlerts = await listPendingAlerts(
    tx,
    tenantId,
    tripId,
    actor.membershipId,
    actor.roles,
  );
  const names = await loadMembershipNames(tx, tenantId, [header.driverId, header.attendantId]);
  return {
    ...toSummary(header),
    routeVersionId: header.routeVersionId,
    checks,
    stops,
    students,
    locationSessionEpoch: header.locationSessionEpoch,
    locationSourceDeviceId: header.locationSourceDeviceId,
    driverMembershipId: header.driverId,
    attendantMembershipId: header.attendantId,
    driverName: names.get(header.driverId ?? '') ?? null,
    attendantName: names.get(header.attendantId ?? '') ?? null,
    seatCount: header.seatCount,
    live,
    pendingAlerts,
  };
}

interface TripRow {
  id: string;
  routeId: string;
  routeVersionId: string;
  serviceDate: string | Date;
  segment: 'MORNING' | 'AFTERNOON';
  state: string;
  plannedDepartureAt: Date | string;
  vehicleId: string;
  plate: string;
  schoolName: string;
  schoolId: string;
  attendantId: string | null;
  driverId: string | null;
  locationSessionEpoch: number;
  locationSourceDeviceId: string | null;
  seatCount: number;
}

async function loadTripForActor(
  tx: Database,
  tenantId: string,
  actor: TripActor,
  tripId: string,
): Promise<TripRow> {
  const [row] = await tx
    .select({
      id: trip.id,
      routeId: trip.routeId,
      routeVersionId: trip.routeVersionId,
      serviceDate: trip.serviceDate,
      segment: trip.segment,
      state: trip.state,
      plannedDepartureAt: trip.plannedDepartureAt,
      vehicleId: trip.currentVehicleId,
      plate: vehicle.plate,
      schoolName: school.name,
      schoolId: route.schoolId,
      attendantId: trip.currentAttendantMembershipId,
      driverId: trip.currentDriverMembershipId,
      locationSessionEpoch: trip.locationSessionEpoch,
      locationSourceDeviceId: trip.locationSourceDeviceId,
      seatCount: vehicle.seatCount,
    })
    .from(trip)
    .innerJoin(route, and(eq(route.id, trip.routeId), eq(route.tenantId, tenantId)))
    .innerJoin(vehicle, and(eq(vehicle.id, trip.currentVehicleId), eq(vehicle.tenantId, tenantId)))
    .innerJoin(school, and(eq(school.id, route.schoolId), eq(school.tenantId, tenantId)))
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  if (!row) throw notFound('Sefer bulunamadı');
  if (!actor.roles.includes('ADMIN')) {
    const allowed = await assignedTripIds(tx, tenantId, actor.membershipId, [tripId]);
    if (!allowed.has(tripId)) throw notFound('Sefer bulunamadı');
  }
  return row;
}

async function loadTripSummary(
  tx: Database,
  tenantId: string,
  tripId: string,
): Promise<TripSummary | null> {
  const [row] = await tx
    .select({
      id: trip.id,
      routeId: trip.routeId,
      serviceDate: trip.serviceDate,
      segment: trip.segment,
      state: trip.state,
      plannedDepartureAt: trip.plannedDepartureAt,
      vehicleId: trip.currentVehicleId,
      plate: vehicle.plate,
      schoolName: school.name,
    })
    .from(trip)
    .innerJoin(route, and(eq(route.id, trip.routeId), eq(route.tenantId, tenantId)))
    .innerJoin(vehicle, and(eq(vehicle.id, trip.currentVehicleId), eq(vehicle.tenantId, tenantId)))
    .innerJoin(school, and(eq(school.id, route.schoolId), eq(school.tenantId, tenantId)))
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  return row ? toSummary(row) : null;
}

async function loadCrewGuardians(
  tx: Database,
  tenantId: string,
  studentIds: string[],
): Promise<Map<string, { phone: string; name: string }>> {
  const chosen = new Map<string, { phone: string; name: string; rank: number }>();
  if (studentIds.length === 0) return new Map();
  const rows = await tx
    .select({
      studentId: studentGuardian.studentId,
      phone: identity.phoneE164,
      name: identity.fullName,
      isPrimary: studentGuardian.isPrimary,
      canReceiveChild: studentGuardian.canReceiveChild,
    })
    .from(studentGuardian)
    .innerJoin(
      tenantMembership,
      and(
        eq(tenantMembership.id, studentGuardian.guardianMembershipId),
        eq(tenantMembership.tenantId, tenantId),
      ),
    )
    .innerJoin(identity, eq(identity.id, tenantMembership.identityId))
    .where(
      and(
        eq(studentGuardian.tenantId, tenantId),
        eq(studentGuardian.status, 'ACTIVE'),
        inArray(studentGuardian.studentId, studentIds),
      ),
    );
  for (const row of rows) {
    const rank = row.isPrimary ? 0 : row.canReceiveChild ? 1 : 2;
    const current = chosen.get(row.studentId);
    if (!current || rank < current.rank) {
      chosen.set(row.studentId, { phone: row.phone, name: row.name, rank });
    }
  }
  const result = new Map<string, { phone: string; name: string }>();
  for (const [id, value] of chosen) {
    result.set(id, { phone: value.phone, name: value.name });
  }
  return result;
}

async function loadMembershipNames(
  tx: Database,
  tenantId: string,
  membershipIds: Array<string | null>,
): Promise<Map<string, string>> {
  const ids = [...new Set(membershipIds.filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      membershipId: tenantMembership.id,
      fullName: identity.fullName,
    })
    .from(tenantMembership)
    .innerJoin(identity, eq(identity.id, tenantMembership.identityId))
    .where(and(eq(tenantMembership.tenantId, tenantId), inArray(tenantMembership.id, ids)));
  return new Map(rows.map((row) => [row.membershipId, row.fullName]));
}

function toSummary(row: {
  id: string;
  routeId: string;
  serviceDate: string | Date;
  segment: 'MORNING' | 'AFTERNOON';
  state: string;
  plannedDepartureAt: Date | string;
  vehicleId: string;
  plate: string;
  schoolName: string;
}): TripSummary {
  return {
    id: row.id,
    routeId: row.routeId,
    serviceDate: dateOnly(row.serviceDate),
    segment: row.segment,
    state: asTripState(row.state),
    plannedDepartureAt: instantIso(row.plannedDepartureAt),
    vehicleId: row.vehicleId,
    plate: row.plate,
    schoolName: row.schoolName,
  };
}

async function assignedTripIds(
  tx: Database,
  tenantId: string,
  membershipId: string,
  tripIds: string[],
): Promise<Set<string>> {
  if (tripIds.length === 0) return new Set();
  const now = new Date();
  const rows = await tx
    .select({ tripId: tripCrewAssignment.tripId })
    .from(tripCrewAssignment)
    .innerJoin(trip, and(eq(trip.id, tripCrewAssignment.tripId), eq(trip.tenantId, tenantId)))
    .where(
      and(
        eq(tripCrewAssignment.tenantId, tenantId),
        eq(tripCrewAssignment.membershipId, membershipId),
        inArray(tripCrewAssignment.tripId, tripIds),
        or(isNull(tripCrewAssignment.validTo), gt(tripCrewAssignment.validTo, now)),
        lte(tripCrewAssignment.validFrom, trip.plannedDepartureAt),
      ),
    );
  return new Set(rows.map((row) => row.tripId));
}

async function reviveAfterCheck(
  tx: Database,
  tenantId: string,
  tripId: string,
  membershipId: string,
): Promise<boolean> {
  const [updated] = await tx
    .update(tripVehicleCheck)
    .set({
      vehicleEmptyConfirmed: true,
      checkedBy: membershipId,
      at: new Date(),
    })
    .where(
      and(
        eq(tripVehicleCheck.tenantId, tenantId),
        eq(tripVehicleCheck.tripId, tripId),
        eq(tripVehicleCheck.phase, 'AFTER'),
        eq(tripVehicleCheck.vehicleEmptyConfirmed, false),
      ),
    )
    .returning({ id: tripVehicleCheck.id });
  return Boolean(updated);
}

async function hasCheck(
  tx: Database,
  tenantId: string,
  tripId: string,
  phase: 'BEFORE' | 'AFTER',
): Promise<boolean> {
  const [row] = await tx
    .select({ id: tripVehicleCheck.id })
    .from(tripVehicleCheck)
    .where(
      and(
        eq(tripVehicleCheck.tenantId, tenantId),
        eq(tripVehicleCheck.tripId, tripId),
        eq(tripVehicleCheck.phase, phase),
        eq(tripVehicleCheck.vehicleEmptyConfirmed, true),
      ),
    );
  return Boolean(row);
}

async function assertTripReadyCrew(tx: Database, tenantId: string, row: TripRow): Promise<void> {
  const [schoolRow] = await tx
    .select({ attendantRequired: school.attendantRequired })
    .from(school)
    .where(and(eq(school.id, row.schoolId), eq(school.tenantId, tenantId)));
  const block = tripReadyCrewBlock({
    driverMembershipId: row.driverId,
    attendantMembershipId: row.attendantId,
    attendantRequired: schoolRow?.attendantRequired ?? false,
  });
  switch (block) {
    case null:
      return;
    case 'DRIVER_MISSING':
      throw conflict('crew_incomplete', 'Şoför atanmadan sefer hazır olamaz');
    case 'ATTENDANT_MISSING':
      throw conflict('crew_incomplete', 'Hostes atanmadan sefer hazır olamaz');
    default: {
      const unexpected: never = block;
      void unexpected;
      throw new Error('unknown ready block');
    }
  }
}

async function attachMissingAttendant(
  tx: Database,
  tenantId: string,
  row: TripRow,
): Promise<TripRow> {
  if (row.attendantId) return row;
  if (row.state !== 'PLANNED' && row.state !== 'READY') return row;
  const [tenantRow] = await tx
    .select({ timezone: tenant.timezone })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!tenantRow) return row;
  const day = dateOnly(row.serviceDate);
  const attendantId = await assignedCrew(
    tx,
    tenantId,
    row.vehicleId,
    'ATTENDANT',
    zonedDayStart(day, tenantRow.timezone),
    zonedDayEnd(day, tenantRow.timezone),
  );
  if (!attendantId) return row;
  await tx
    .update(trip)
    .set({ currentAttendantMembershipId: attendantId })
    .where(
      and(
        eq(trip.id, row.id),
        eq(trip.tenantId, tenantId),
        isNull(trip.currentAttendantMembershipId),
      ),
    );
  const [existing] = await tx
    .select({ id: tripCrewAssignment.id })
    .from(tripCrewAssignment)
    .where(
      and(
        eq(tripCrewAssignment.tenantId, tenantId),
        eq(tripCrewAssignment.tripId, row.id),
        eq(tripCrewAssignment.membershipId, attendantId),
        eq(tripCrewAssignment.role, 'ATTENDANT'),
      ),
    )
    .limit(1);
  if (!existing) {
    await tx.insert(tripCrewAssignment).values({
      tenantId,
      tripId: row.id,
      membershipId: attendantId,
      role: 'ATTENDANT',
      validFrom: zonedDayStart(day, tenantRow.timezone),
    });
  }
  return { ...row, attendantId };
}

async function updateTripWhereState(
  tx: Database,
  tenantId: string,
  tripId: string,
  fromState: TripState,
  values: {
    state: TripState;
    actualStartedAt?: Date;
    locationSourceDeviceId?: string;
    locationSessionEpoch?: number;
    cancelReason?: string;
  },
): Promise<void> {
  const [updated] = await tx
    .update(trip)
    .set(values)
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId), eq(trip.state, fromState)))
    .returning({ id: trip.id });
  if (!updated) throw conflict('illegal_transition', 'Sefer durumu değişti');
}

async function lockTrip(tx: Database, tenantId: string, tripId: string): Promise<void> {
  const row = firstRow(
    await tx.execute(
      sql`select id from trip where id = ${tripId}::uuid and tenant_id = ${tenantId}::uuid for update`,
    ),
  );
  if (!row) throw notFound('Sefer bulunamadı');
}

function requireDeviceId(actor: TripActor): string {
  if (!actor.deviceId) throw badRequest('device_required', 'x-device-id zorunlu');
  return actor.deviceId;
}

async function ensureDevice(tx: Database, tenantId: string, actor: TripActor): Promise<void> {
  const deviceId = requireDeviceId(actor);
  const [existing] = await tx
    .select({ membershipId: device.membershipId, revokedAt: device.revokedAt })
    .from(device)
    .where(and(eq(device.id, deviceId), eq(device.tenantId, tenantId)));
  if (existing) {
    if (existing.membershipId !== actor.membershipId) {
      throw conflict('device_bound', 'Bu cihaz başka personele bağlı');
    }
    if (existing.revokedAt) throw forbidden('Bu cihaz iptal edilmiş');
    await tx
      .update(device)
      .set({
        lastSyncAt: new Date(),
        appVersion: actor.appVersion,
        platform: actor.platform,
      })
      .where(and(eq(device.id, deviceId), eq(device.tenantId, tenantId)));
    return;
  }
  try {
    await tx.insert(device).values({
      id: deviceId,
      tenantId,
      membershipId: actor.membershipId,
      platform: actor.platform,
      appVersion: actor.appVersion ?? undefined,
      lastSyncAt: new Date(),
    });
  } catch (error) {
    if (!isUniqueViolation(error, 'device')) mapDbError(error);
    const [raced] = await tx
      .select({ membershipId: device.membershipId, revokedAt: device.revokedAt })
      .from(device)
      .where(and(eq(device.id, deviceId), eq(device.tenantId, tenantId)));
    if (!raced) mapDbError(error);
    if (raced.membershipId !== actor.membershipId) {
      throw conflict('device_bound', 'Bu cihaz başka personele bağlı');
    }
    if (raced.revokedAt) throw forbidden('Bu cihaz iptal edilmiş');
    await tx
      .update(device)
      .set({
        lastSyncAt: new Date(),
        appVersion: actor.appVersion,
        platform: actor.platform,
      })
      .where(and(eq(device.id, deviceId), eq(device.tenantId, tenantId)));
  }
}

async function beginReceipt(
  tx: Database,
  tenantId: string,
  actor: TripActor,
  input: StudentCommandInput,
): Promise<CommandResult | null> {
  const inserted = await tx
    .insert(commandReceipt)
    .values({
      tenantId,
      clientEventId: input.clientEventId,
      deviceId: requireDeviceId(actor),
      deviceSeq: input.deviceSeq,
      commandType: input.action,
      status: 'PENDING',
    })
    .onConflictDoNothing({ target: [commandReceipt.tenantId, commandReceipt.clientEventId] })
    .returning({ clientEventId: commandReceipt.clientEventId });
  if (inserted.length > 0) return null;
  const [existing] = await tx
    .select({
      status: commandReceipt.status,
      commandType: commandReceipt.commandType,
      responseJson: commandReceipt.responseJson,
      deviceId: commandReceipt.deviceId,
    })
    .from(commandReceipt)
    .where(
      and(
        eq(commandReceipt.tenantId, tenantId),
        eq(commandReceipt.clientEventId, input.clientEventId),
      ),
    )
    .for('update');
  if (existing?.deviceId && existing.deviceId !== requireDeviceId(actor)) {
    throw conflict('command_id_reuse', 'clientEventId başka bir cihaz için kullanılmış');
  }
  if (existing?.commandType && existing.commandType !== input.action) {
    throw conflict('command_id_reuse', 'clientEventId başka bir komut için kullanılmış');
  }
  if (existing?.status === 'PENDING' && !isRecord(existing.responseJson)) {
    return null;
  }
  if (!existing?.responseJson || !isRecord(existing.responseJson)) {
    throw conflict('command_pending', 'Aynı komut hâlâ işleniyor');
  }
  const replay = existing.responseJson;
  const status = asCommandStatus(replay['status']);
  if (!status) throw conflict('command_pending', 'Aynı komut hâlâ işleniyor');
  const seq = Number(replay['stateSeq'] ?? 0);
  return {
    replay: true,
    status,
    tripStudentId:
      typeof replay['tripStudentId'] === 'string' ? replay['tripStudentId'] : input.tripStudentId,
    state: typeof replay['state'] === 'string' ? replay['state'] : '',
    stateSeq: Number.isFinite(seq) ? seq : 0,
    reason: typeof replay['reason'] === 'string' ? replay['reason'] : undefined,
  };
}

async function finishReceipt(
  tx: Database,
  tenantId: string,
  clientEventId: string,
  body: CommandResult,
): Promise<void> {
  await tx
    .update(commandReceipt)
    .set({
      status: body.status,
      responseJson: body,
    })
    .where(
      and(eq(commandReceipt.tenantId, tenantId), eq(commandReceipt.clientEventId, clientEventId)),
    );
}

interface LockedStudent {
  tripId: string;
  tripState: TripState;
  vehicleId: string;
  state: StudentState;
  stateSeq: number;
  deliveryTarget: 'SCHOOL' | 'HOME' | 'TEMP';
  deliveryVerified: boolean;
  studentId: string;
}

async function lockStudent(tx: Database, tripStudentId: string): Promise<LockedStudent> {
  const row = firstRow(
    await tx.execute(sql`select lock_trip_student_for_command(${tripStudentId}::uuid) as result`),
  );
  const result = jsonObject(row?.['result']);
  if (!result) throw notFound('Öğrenci sefer kaydı bulunamadı');
  const tripId = result['tripId'];
  const studentId = result['studentId'];
  const vehicleId = result['vehicleId'];
  const tripState = result['tripState'];
  const state = result['state'];
  const deliveryTarget = result['deliveryTarget'];
  if (
    typeof tripId !== 'string' ||
    typeof studentId !== 'string' ||
    typeof vehicleId !== 'string' ||
    typeof tripState !== 'string' ||
    typeof state !== 'string' ||
    typeof deliveryTarget !== 'string'
  ) {
    throw new HttpError(500, 'lock_failed', 'Öğrenci kilidi okunamadı');
  }
  const stateSeq = Number(result['stateSeq']);
  if (!Number.isInteger(stateSeq)) {
    throw new HttpError(500, 'lock_failed', 'Öğrenci kilidi okunamadı');
  }
  return {
    tripId,
    tripState: tripState as TripState,
    vehicleId,
    state: state as StudentState,
    stateSeq,
    deliveryTarget: deliveryTarget as 'SCHOOL' | 'HOME' | 'TEMP',
    deliveryVerified: result['deliveryVerified'] === true,
    studentId,
  };
}

async function applyLockedTransition(
  tx: Database,
  input: {
    tripStudentId: string;
    expectedStateSeq: number;
    from: StudentState;
    to: StudentState;
    boardedLat?: number;
    boardedLng?: number;
  },
): Promise<{ applied: boolean; state: StudentState; stateSeq: number }> {
  const row = firstRow(
    await tx.execute(sql`
      select apply_student_state_transition(
        ${input.tripStudentId}::uuid,
        ${input.expectedStateSeq}::integer,
        ${input.from}::student_state,
        ${input.to}::student_state,
        ${input.boardedLat ?? null}::double precision,
        ${input.boardedLng ?? null}::double precision,
        null::uuid
      ) as result
    `),
  );
  const result = jsonObject(row?.['result']);
  if (!result) throw new HttpError(500, 'transition_failed', 'Durum geçişi uygulanamadı');
  const stateSeq = Number(result['stateSeq']);
  if (typeof result['state'] !== 'string' || !Number.isInteger(stateSeq)) {
    throw new HttpError(500, 'transition_failed', 'Durum geçişi uygulanamadı');
  }
  return {
    applied: result['applied'] === true,
    state: result['state'] as StudentState,
    stateSeq,
  };
}

async function insertEvent(
  tx: Database,
  input: {
    tenantId: string;
    actor: TripActor;
    tripId: string;
    vehicleId: string;
    subjectType: string;
    subjectId: string;
    eventType: string;
    prevState: string | null;
    newState: string | null;
    lat?: number;
    lng?: number;
    occurredAtDevice?: string;
    sourceCommandId?: string;
    actorRoleOverride?: ActorRole;
    skipDevice?: boolean;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(event).values({
    tenantId: input.tenantId,
    actorMembershipId:
      input.actorRoleOverride === 'SYSTEM' || input.actor.membershipId === ''
        ? null
        : input.actor.membershipId,
    actorRole: input.actorRoleOverride ?? actorRoleOf(input.actor),
    deviceId: input.skipDevice ? null : input.actor.deviceId,
    vehicleId: input.vehicleId,
    tripId: input.tripId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    eventType: input.eventType,
    prevState: input.prevState,
    newState: input.newState,
    lat: input.lat,
    lng: input.lng,
    occurredAtDevice: input.occurredAtDevice ? new Date(input.occurredAtDevice) : null,
    sourceCommandId: input.sourceCommandId,
    appVersion: input.actor.appVersion,
    payload: input.payload ?? {},
  });
}

function actorRoleOf(actor: TripActor): ActorRole {
  if (actor.roles.includes('ADMIN')) return 'ADMIN';
  if (actor.roles.includes('DRIVER')) return 'DRIVER';
  if (actor.roles.includes('ATTENDANT')) return 'ATTENDANT';
  throw forbidden();
}

function tripDecisionError(
  reason:
    | 'ILLEGAL_TRANSITION'
    | 'ROLE_NOT_ALLOWED'
    | 'STUDENTS_STILL_ON_TRIP'
    | 'VEHICLE_SWEEP_NOT_CONFIRMED',
): HttpError {
  switch (reason) {
    case 'ILLEGAL_TRANSITION':
      return conflict('illegal_transition', 'Bu sefer geçişi izinli değil');
    case 'ROLE_NOT_ALLOWED':
      return forbidden();
    case 'STUDENTS_STILL_ON_TRIP':
      return conflict('students_still_on_trip', 'Araçta öğrenci varken sefer kapanamaz');
    case 'VEHICLE_SWEEP_NOT_CONFIRMED':
      return conflict('vehicle_sweep_not_confirmed', 'Sefer sonu araç boş kontrolü yok');
    default: {
      const unexpected: never = reason;
      return unexpected;
    }
  }
}

function asCommandStatus(value: unknown): CommandResult['status'] | null {
  if (value === 'APPLIED' || value === 'CONFLICT' || value === 'REJECTED') return value;
  return null;
}

function asTripState(value: string): TripState {
  if ((TRIP_STATES as readonly string[]).includes(value)) return value as TripState;
  throw new HttpError(500, 'invalid_state', 'Sefer durumu okunamadı');
}

function instantIso(value: Date | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new HttpError(500, 'invalid_date', 'Tarih okunamadı');
    return value.toISOString().replace(/Z$/, '+00:00');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(500, 'invalid_date', 'Tarih okunamadı');
  return parsed.toISOString().replace(/Z$/, '+00:00');
}

function studentUsesSegment(
  segment: 'MORNING' | 'AFTERNOON',
  row: { usesMorning: boolean; usesEvening: boolean },
): boolean {
  switch (segment) {
    case 'MORNING':
      return row.usesMorning;
    case 'AFTERNOON':
      return row.usesEvening;
    default: {
      const unexpected: never = segment;
      void unexpected;
      return false;
    }
  }
}

function dateOnly(value: string | Date): string {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match?.[1]) return match[1];
    throw new HttpError(500, 'invalid_date', 'Tarih okunamadı');
  }
  if (Number.isNaN(value.getTime())) throw new HttpError(500, 'invalid_date', 'Tarih okunamadı');
  return value.toISOString().slice(0, 10);
}

async function withTrip<T>(
  db: Database,
  tenantId: string,
  membershipId: string | null,
  role: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await withTenant(db, { tenantId, membershipId, role }, fn);
  } catch (error) {
    mapDbError(error);
  }
}
