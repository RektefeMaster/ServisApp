import type {
  AddressChangeView,
  AdminDeliveryOverrideView,
  AdminExceptionsList,
  AdminOverrideDeliveryInput,
  CreateAddressChangeInput,
  CreateDeliveryOverrideInput,
  CreateRideExceptionInput,
  DeliveryOverrideView,
  ParentDayPlan,
  RideExceptionView,
  VerifyDeliveryOtpInput,
} from '@servisapp/contracts';
import {
  address,
  addressChangeRequest,
  criticalChangeAck,
  criticalChangeAlert,
  deliveryOverride,
  platformSettings,
  rideException,
  route,
  student,
  studentAddress,
  studentGuardian,
  tenant,
  trip,
  tripCrewAssignment,
  tripStudent,
  withTenant,
  type Database,
} from '@servisapp/db';
import {
  canGuardianManageDeliveryOverride,
  canGuardianViewDeliveryOtp,
  canResendOtp,
  detourDecision,
  exhaustive,
  haversineMeters,
  OTP_MAX_ATTEMPTS,
  otpLockedAfterAttempts,
  reconcileCancelRideException,
  reconcileStudent,
  ymdInTimeZone,
  zonedDayEnd,
} from '@servisapp/domain';
import { and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  decryptDeliveryOtp,
  encryptDeliveryOtp,
  generateDeliveryOtpCode,
  hmacDeliveryOtp,
  otpHmacMatches,
} from '../crypto/delivery-otp.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http-error.js';
import { isUniqueViolation, mapDbError } from './db-error.js';
import { queueGuardianNotifications } from './notify-queue.js';
import {
  applyTripStudentPlan,
  cancelActiveOverrides,
  findOpenTripStudents,
  insertPlanEvent,
  raiseCriticalAlert,
  requirePlanApplied,
} from './plan-reconcile.js';
import { firstRow } from './sql-result.js';
import { refreshRoutesIfTripChanged } from './tracking.js';

export interface OtpSecrets {
  pepper: string;
  encryptionKey: string;
}

interface GuardianLink {
  canSubmitException: boolean;
  canAuthorizeTempAddress: boolean;
  studentName: string;
}

function asBuffer(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

async function withActor<T>(
  db: Database,
  tenantId: string,
  membershipId: string,
  role: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await withTenant(db, { tenantId, membershipId, role }, fn);
  } catch (error) {
    if (isUniqueViolation(error, 'ride_exception_active')) {
      throw conflict('exception_exists', 'Bu gün ve sefer için zaten istisna var');
    }
    if (isUniqueViolation(error, 'delivery_override_active')) {
      throw conflict('override_exists', 'Bu gün için zaten farklı teslimat talebi var');
    }
    mapDbError(error);
  }
}

async function assertOtpLive(tx: Database): Promise<void> {
  const [row] = await tx
    .select({ killOtp: platformSettings.killOtp })
    .from(platformSettings)
    .where(eq(platformSettings.id, true));
  if (row?.killOtp) {
    throw new HttpError(409, 'otp_killed', 'OTP şu an kapalı');
  }
}

async function assertCrewOnTrip(
  tx: Database,
  tenantId: string,
  tripId: string,
  membershipId: string,
  roles: string[],
): Promise<void> {
  const [header] = await tx
    .select({ id: trip.id, plannedDepartureAt: trip.plannedDepartureAt })
    .from(trip)
    .where(and(eq(trip.id, tripId), eq(trip.tenantId, tenantId)));
  if (!header) throw notFound('Sefer bulunamadı');
  if (roles.includes('ADMIN')) return;
  const now = new Date();
  const [assigned] = await tx
    .select({ tripId: tripCrewAssignment.tripId })
    .from(tripCrewAssignment)
    .where(
      and(
        eq(tripCrewAssignment.tenantId, tenantId),
        eq(tripCrewAssignment.tripId, tripId),
        eq(tripCrewAssignment.membershipId, membershipId),
        or(isNull(tripCrewAssignment.validTo), gt(tripCrewAssignment.validTo, now)),
        lte(tripCrewAssignment.validFrom, header.plannedDepartureAt),
      ),
    );
  if (!assigned) throw notFound('Sefer bulunamadı');
}

async function tenantZone(tx: Database, tenantId: string): Promise<string> {
  const [row] = await tx
    .select({ timezone: tenant.timezone })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  return row?.timezone ?? 'Europe/Istanbul';
}

async function requireGuardian(
  tx: Database,
  tenantId: string,
  membershipId: string,
  studentId: string,
): Promise<GuardianLink> {
  const [row] = await tx
    .select({
      canSubmitException: studentGuardian.canSubmitException,
      canAuthorizeTempAddress: studentGuardian.canAuthorizeTempAddress,
      studentName: student.fullName,
      status: studentGuardian.status,
    })
    .from(studentGuardian)
    .innerJoin(
      student,
      and(eq(student.id, studentGuardian.studentId), eq(student.tenantId, tenantId)),
    )
    .where(
      and(
        eq(studentGuardian.tenantId, tenantId),
        eq(studentGuardian.studentId, studentId),
        eq(studentGuardian.guardianMembershipId, membershipId),
      ),
    );
  if (!row || row.status !== 'ACTIVE') throw notFound('Öğrenci bulunamadı');
  return row;
}

async function notifyGuardians(
  tx: Database,
  tenantId: string,
  studentId: string,
  type: string,
  dedupe: string,
  channel: 'PUSH' | 'SMS' = 'PUSH',
  extra?: { tripId?: string | null; refId?: string | null },
): Promise<void> {
  await queueGuardianNotifications(tx, {
    tenantId,
    studentId,
    type,
    dedupe,
    channel,
    tripId: extra?.tripId,
    refId: extra?.refId,
    requireAuthorizeTempAddress: type === 'DELIVERY_OTP',
  });
}

function asYmd(value: string | Date): string {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match?.[1]) return match[1];
  } else {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.toISOString());
    if (match?.[1]) return match[1];
  }
  throw new HttpError(500, 'invalid_date', 'Tarih okunamadı');
}

async function homeDropoff(
  tx: Database,
  tenantId: string,
  studentId: string,
  onDate: string,
): Promise<{ lat: number; lng: number; text: string; il: string; ilce: string } | null> {
  const [row] = await tx
    .select({
      lat: address.lat,
      lng: address.lng,
      text: address.text,
      il: address.il,
      ilce: address.ilce,
    })
    .from(studentAddress)
    .innerJoin(
      address,
      and(eq(address.id, studentAddress.addressId), eq(address.tenantId, tenantId)),
    )
    .where(
      and(
        eq(studentAddress.tenantId, tenantId),
        eq(studentAddress.studentId, studentId),
        eq(studentAddress.usage, 'DROPOFF'),
        sql`${studentAddress.validFrom} <= ${onDate}`,
        or(isNull(studentAddress.validTo), sql`${studentAddress.validTo} >= ${onDate}`),
      ),
    )
    .orderBy(desc(studentAddress.validFrom), desc(studentAddress.id))
    .limit(1);
  return row ?? null;
}

async function routeMaxDetour(tx: Database, tenantId: string, studentId: string): Promise<number> {
  const [fromTrip] = await tx
    .select({ maxDetourM: route.maxDetourM })
    .from(tripStudent)
    .innerJoin(trip, and(eq(trip.id, tripStudent.tripId), eq(trip.tenantId, tenantId)))
    .innerJoin(route, and(eq(route.id, trip.routeId), eq(route.tenantId, tenantId)))
    .where(
      and(
        eq(tripStudent.tenantId, tenantId),
        eq(tripStudent.studentId, studentId),
        eq(trip.segment, 'AFTERNOON'),
        inArray(trip.state, ['PLANNED', 'READY', 'ACTIVE']),
      ),
    )
    .limit(1);
  if (fromTrip) return fromTrip.maxDetourM;
  return 1500;
}

async function applyRideExceptionToTrips(
  tx: Database,
  input: {
    tenantId: string;
    membershipId: string;
    studentId: string;
    studentName: string;
    serviceDate: string;
    segment: 'MORNING' | 'AFTERNOON';
  },
): Promise<{ kind: string }> {
  const open = await findOpenTripStudents(
    tx,
    input.tenantId,
    input.studentId,
    input.serviceDate,
    input.segment,
  );
  let lastKind = 'NONE';
  for (const item of open) {
    const outcome = reconcileStudent(item.studentState, 'RIDE_EXCEPTION');
    lastKind = outcome.kind;
    switch (outcome.kind) {
      case 'APPLY': {
        requirePlanApplied(
          await applyTripStudentPlan(tx, {
            tripStudentId: item.tripStudentId,
            state: outcome.nextState,
          }),
        );
        await insertPlanEvent(tx, {
          tenantId: input.tenantId,
          membershipId: input.membershipId,
          role: 'GUARDIAN',
          tripId: item.tripId,
          vehicleId: item.vehicleId,
          subjectType: 'TRIP_STUDENT',
          subjectId: item.tripStudentId,
          eventType: 'PLAN_ABSENT',
          prevState: item.studentState,
          newState: outcome.nextState,
        });
        if (item.tripState === 'ACTIVE') {
          await raiseCriticalAlert(tx, {
            tenantId: input.tenantId,
            tripId: item.tripId,
            stopId: item.expectedStopId,
            body: `${input.studentName} bugün ${input.segment === 'MORNING' ? 'sabah' : 'akşam'} binmeyecek`,
          });
        }
        break;
      }
      case 'FLAG_FOR_REVIEW':
        await applyTripStudentPlan(tx, { tripStudentId: item.tripStudentId, needsReview: true });
        break;
      case 'REJECT':
        throw conflict('student_on_board', 'Çocuk araçta; bugün binmeyecek uygulanamaz');
      case 'IGNORE':
      case 'APPLY_TARGET':
        break;
      default:
        return exhaustive(outcome, 'applyRideExceptionToTrips');
    }
  }
  return { kind: lastKind };
}

async function applyOverrideToAfternoon(
  tx: Database,
  input: {
    tenantId: string;
    membershipId: string;
    studentId: string;
    studentName: string;
    serviceDate: string;
    receiverName: string;
    dropoff: { lat: number; lng: number; text: string };
  },
): Promise<void> {
  const open = await findOpenTripStudents(
    tx,
    input.tenantId,
    input.studentId,
    input.serviceDate,
    'AFTERNOON',
  );
  for (const item of open) {
    const outcome = reconcileStudent(item.studentState, 'DELIVERY_OVERRIDE');
    switch (outcome.kind) {
      case 'APPLY_TARGET': {
        requirePlanApplied(
          await applyTripStudentPlan(tx, {
            tripStudentId: item.tripStudentId,
            deliveryTarget: 'TEMP',
            receiverName: input.receiverName,
            dropoff: input.dropoff,
            needsReview: item.studentState === 'NO_SHOW' ? true : undefined,
          }),
        );
        await insertPlanEvent(tx, {
          tenantId: input.tenantId,
          membershipId: input.membershipId,
          role: 'GUARDIAN',
          tripId: item.tripId,
          vehicleId: item.vehicleId,
          subjectType: 'TRIP_STUDENT',
          subjectId: item.tripStudentId,
          eventType: 'PLAN_TEMP_DELIVERY',
          prevState: item.studentState,
          newState: item.studentState,
        });
        if (item.tripState === 'ACTIVE') {
          await raiseCriticalAlert(tx, {
            tenantId: input.tenantId,
            tripId: item.tripId,
            stopId: item.expectedStopId,
            body: `${input.studentName} bugün farklı adrese bırakılacak (${input.receiverName})`,
          });
          await refreshRoutesIfTripChanged(tx, input.tenantId, item.tripId);
        }
        break;
      }
      case 'REJECT':
        throw conflict('student_on_board', 'Çocuk araçta; farklı teslimat uygulanamaz');
      case 'FLAG_FOR_REVIEW':
        await applyTripStudentPlan(tx, { tripStudentId: item.tripStudentId, needsReview: true });
        break;
      case 'IGNORE':
      case 'APPLY':
        break;
      default:
        return exhaustive(outcome, 'applyOverrideToAfternoon');
    }
  }
}

function issueOtp(secrets: OtpSecrets, serviceDate: string, timeZone: string) {
  const code = generateDeliveryOtpCode();
  const expiresAt = new Date(zonedDayEnd(serviceDate, timeZone).getTime() + 6 * 60 * 60 * 1000);
  return {
    code,
    hmac: hmacDeliveryOtp(code, secrets.pepper),
    ciphertext: encryptDeliveryOtp(code, secrets.encryptionKey),
    expiresAt,
  };
}

function overrideToView(
  row: {
    id: string;
    studentId: string;
    serviceDate: string | Date;
    status: DeliveryOverrideView['status'];
    receiverName: string;
  },
  extra: {
    studentName: string;
    addressText: string;
    detourM: number;
    maxDetourM: number;
    otpCode: string | null;
  },
): DeliveryOverrideView {
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: extra.studentName,
    serviceDate: asYmd(row.serviceDate),
    status: row.status,
    receiverName: row.receiverName,
    addressText: extra.addressText,
    detourM: extra.detourM,
    maxDetourM: extra.maxDetourM,
    otpCode: extra.otpCode,
  };
}

export function createExceptionsPort(db: Database, secrets: OtpSecrets) {
  return {
    createRideException(tenantId: string, membershipId: string, input: CreateRideExceptionInput) {
      return withActor(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        const guardian = await requireGuardian(tx, tenantId, membershipId, input.studentId);
        if (!guardian.canSubmitException) throw forbidden('Bu veli istisna bildiremez');
        const zone = await tenantZone(tx, tenantId);
        const today = ymdInTimeZone(new Date(), zone);
        if (input.serviceDate < today) throw badRequest('past_date', 'Geçmiş gün için istisna yok');
        const uniqueSegments: Array<'MORNING' | 'AFTERNOON'> = [...new Set(input.segments)];
        const created: RideExceptionView[] = [];
        for (const segment of uniqueSegments) {
          const [row] = await tx
            .insert(rideException)
            .values({
              tenantId,
              studentId: input.studentId,
              serviceDate: input.serviceDate,
              segment,
              createdByMembershipId: membershipId,
              source: 'PARENT',
            })
            .returning({
              id: rideException.id,
              studentId: rideException.studentId,
              serviceDate: rideException.serviceDate,
              segment: rideException.segment,
              source: rideException.source,
              cancelledAt: rideException.cancelledAt,
            });
          if (!row) throw new HttpError(500, 'insert_failed', 'İstisna yazılamadı');
          await applyRideExceptionToTrips(tx, {
            tenantId,
            membershipId,
            studentId: input.studentId,
            studentName: guardian.studentName,
            serviceDate: input.serviceDate,
            segment,
          });
          created.push({
            id: row.id,
            studentId: row.studentId,
            studentName: guardian.studentName,
            serviceDate: asYmd(row.serviceDate),
            segment: row.segment,
            source: row.source,
            cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
          });
        }
        await notifyGuardians(
          tx,
          tenantId,
          input.studentId,
          'RIDE_EXCEPTION',
          `ex:${input.studentId}:${input.serviceDate}`,
        );
        return { items: created };
      });
    },

    cancelRideException(tenantId: string, membershipId: string, exceptionId: string) {
      return withActor(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        const [row] = await tx
          .select()
          .from(rideException)
          .where(and(eq(rideException.id, exceptionId), eq(rideException.tenantId, tenantId)));
        if (!row || row.cancelledAt) throw notFound('İstisna bulunamadı');
        if (row.createdByMembershipId !== membershipId) throw forbidden();
        const guardian = await requireGuardian(tx, tenantId, membershipId, row.studentId);
        await tx
          .update(rideException)
          .set({ cancelledAt: new Date() })
          .where(and(eq(rideException.id, exceptionId), eq(rideException.tenantId, tenantId)));
        const serviceDate = asYmd(row.serviceDate);
        const open = await findOpenTripStudents(
          tx,
          tenantId,
          row.studentId,
          serviceDate,
          row.segment,
        );
        for (const item of open) {
          const outcome = reconcileCancelRideException(item.studentState);
          if (outcome.kind !== 'APPLY') continue;
          requirePlanApplied(
            await applyTripStudentPlan(tx, {
              tripStudentId: item.tripStudentId,
              state: outcome.nextState,
            }),
          );
          if (item.tripState === 'ACTIVE') {
            await raiseCriticalAlert(tx, {
              tenantId,
              tripId: item.tripId,
              stopId: item.expectedStopId,
              body: `${guardian.studentName} yine ${row.segment === 'MORNING' ? 'sabah' : 'akşam'} binecek`,
            });
          }
        }
        return { ok: true as const };
      });
    },

    createDeliveryOverride(
      tenantId: string,
      membershipId: string,
      input: CreateDeliveryOverrideInput,
    ) {
      return withActor(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        await assertOtpLive(tx);
        const guardian = await requireGuardian(tx, tenantId, membershipId, input.studentId);
        if (
          !canGuardianManageDeliveryOverride({
            relationActive: true,
            canAuthorizeTempAddress: guardian.canAuthorizeTempAddress,
          })
        ) {
          throw forbidden('Bu veli farklı teslimat yetkisine sahip değil');
        }
        const zone = await tenantZone(tx, tenantId);
        const today = ymdInTimeZone(new Date(), zone);
        if (input.serviceDate < today)
          throw badRequest('past_date', 'Geçmiş gün için farklı teslimat yok');
        const baseline = await homeDropoff(tx, tenantId, input.studentId, input.serviceDate);
        const maxDetourM = await routeMaxDetour(tx, tenantId, input.studentId);
        const detourM = baseline
          ? Math.round(
              haversineMeters(
                { lat: baseline.lat, lng: baseline.lng },
                { lat: input.lat, lng: input.lng },
              ),
            )
          : maxDetourM + 1;
        const decision = detourDecision(detourM, maxDetourM);
        const [addr] = await tx
          .insert(address)
          .values({
            tenantId,
            text: input.addressText,
            il: baseline?.il ?? 'İstanbul',
            ilce: baseline?.ilce ?? 'Kadıköy',
            lat: input.lat,
            lng: input.lng,
          })
          .returning({ id: address.id });
        if (!addr) throw new HttpError(500, 'insert_failed', 'Adres kaydedilemedi');
        const otp = decision === 'AUTO' ? issueOtp(secrets, input.serviceDate, zone) : null;
        const [row] = await tx
          .insert(deliveryOverride)
          .values({
            tenantId,
            studentId: input.studentId,
            serviceDate: input.serviceDate,
            addressId: addr.id,
            receiverName: input.receiverName,
            receiverPhone: input.receiverPhone,
            status: decision === 'AUTO' ? 'ACTIVE' : 'PENDING_APPROVAL',
            otpHmac: otp?.hmac,
            otpCiphertext: otp?.ciphertext,
            otpExpiresAt: otp?.expiresAt,
          })
          .returning({
            id: deliveryOverride.id,
            studentId: deliveryOverride.studentId,
            serviceDate: deliveryOverride.serviceDate,
            status: deliveryOverride.status,
            receiverName: deliveryOverride.receiverName,
          });
        if (!row) throw new HttpError(500, 'insert_failed', 'Teslim talebi yazılamadı');
        if (decision === 'AUTO') {
          await applyOverrideToAfternoon(tx, {
            tenantId,
            membershipId,
            studentId: input.studentId,
            studentName: guardian.studentName,
            serviceDate: input.serviceDate,
            receiverName: input.receiverName,
            dropoff: { lat: input.lat, lng: input.lng, text: input.addressText },
          });
        }
        await notifyGuardians(
          tx,
          tenantId,
          input.studentId,
          'DELIVERY_OVERRIDE',
          `ov:${input.studentId}:${input.serviceDate}`,
        );
        if (otp) {
        await notifyGuardians(
          tx,
          tenantId,
          input.studentId,
          'DELIVERY_OTP',
          `otp:${row.id}:0`,
          'SMS',
          { refId: row.id },
        );
        }
        return overrideToView(row, {
          studentName: guardian.studentName,
          addressText: input.addressText,
          detourM,
          maxDetourM,
          otpCode: otp?.code ?? null,
        });
      });
    },

    cancelDeliveryOverride(tenantId: string, membershipId: string, overrideId: string) {
      return withActor(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        const [row] = await tx
          .select()
          .from(deliveryOverride)
          .where(and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)));
        if (!row) throw notFound('Teslim talebi bulunamadı');
        const guardian = await requireGuardian(tx, tenantId, membershipId, row.studentId);
        if (
          !canGuardianManageDeliveryOverride({
            relationActive: true,
            canAuthorizeTempAddress: guardian.canAuthorizeTempAddress,
          })
        ) {
          throw forbidden('Bu veli farklı teslimat yetkisine sahip değil');
        }
        if (!['PENDING_APPROVAL', 'ACTIVE', 'LOCKED'].includes(row.status)) {
          throw conflict('override_inactive', 'Bu talep iptal edilemez');
        }
        const serviceDate = asYmd(row.serviceDate);
        const open = await findOpenTripStudents(
          tx,
          tenantId,
          row.studentId,
          serviceDate,
          'AFTERNOON',
        );
        if (open.some((item) => item.studentState === 'ON_BOARD')) {
          throw conflict('student_on_board', 'Çocuk araçta; farklı teslimat iptal edilemez');
        }
        await cancelActiveOverrides(tx, tenantId, row.studentId, serviceDate, {
          raiseAlert: true,
        });
        return { ok: true as const };
      });
    },

    resendDeliveryOtp(tenantId: string, membershipId: string, overrideId: string) {
      return withActor(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        await assertOtpLive(tx);
        const [row] = await tx
          .select()
          .from(deliveryOverride)
          .where(and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)));
        if (!row) throw notFound('Teslim talebi bulunamadı');
        const guardian = await requireGuardian(tx, tenantId, membershipId, row.studentId);
        if (
          !canGuardianManageDeliveryOverride({
            relationActive: true,
            canAuthorizeTempAddress: guardian.canAuthorizeTempAddress,
          })
        ) {
          throw forbidden('Bu veli farklı teslimat yetkisine sahip değil');
        }
        if (row.status !== 'ACTIVE' && row.status !== 'EXPIRED')
          throw conflict('override_not_active', 'Kod yalnız aktif veya süresi dolmuş talepte yenilenir');
        const resendCount = Number(row.resendCount);
        const used = Number.isFinite(resendCount) ? resendCount : 0;
        if (!canResendOtp(used))
          throw conflict('otp_resend_limit', 'Yeniden gönderim limiti doldu');
        const zone = await tenantZone(tx, tenantId);
        const serviceDate = asYmd(row.serviceDate);
        const expired =
          row.status === 'EXPIRED' ||
          Boolean(row.otpExpiresAt && row.otpExpiresAt.getTime() <= Date.now());
        let code: string;
        const nextResend = used + 1;
        if (expired || !asBuffer(row.otpCiphertext)) {
          const otp = issueOtp(secrets, serviceDate, zone);
          // protect_otp_columns: non-null → non-null yasak; önce temizle.
          await tx
            .update(deliveryOverride)
            .set({ otpHmac: null, otpCiphertext: null })
            .where(
              and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)),
            );
          await tx
            .update(deliveryOverride)
            .set({
              otpHmac: otp.hmac,
              otpCiphertext: otp.ciphertext,
              otpExpiresAt: otp.expiresAt,
              resendCount: nextResend,
              attemptCount: 0,
              status: 'ACTIVE',
            })
            .where(
              and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)),
            );
          code = otp.code;
        } else {
          try {
            code = decryptDeliveryOtp(asBuffer(row.otpCiphertext)!, secrets.encryptionKey);
          } catch {
            throw new HttpError(500, 'otp_decrypt_failed', 'Teslim kodu çözülemedi');
          }
          await tx
            .update(deliveryOverride)
            .set({ resendCount: nextResend })
            .where(
              and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)),
            );
        }
        const [addr] = await tx
          .select({ text: address.text })
          .from(address)
          .where(and(eq(address.id, row.addressId), eq(address.tenantId, tenantId)));
        await notifyGuardians(
          tx,
          tenantId,
          row.studentId,
          'DELIVERY_OTP',
          `otp:${row.id}:${nextResend}`,
          'SMS',
          { refId: row.id },
        );
        return {
          id: row.id,
          otpCode: code,
          addressText: addr?.text ?? '',
          resendCount: nextResend,
        };
      });
    },

    getParentDayPlan(
      tenantId: string,
      membershipId: string,
      studentId: string,
      date?: string,
    ): Promise<ParentDayPlan> {
      return withActor(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        const guardian = await requireGuardian(tx, tenantId, membershipId, studentId);
        const zone = await tenantZone(tx, tenantId);
        const today = ymdInTimeZone(new Date(), zone);
        const serviceDate = date ?? today;
        if (serviceDate < today) throw badRequest('past_date', 'Geçmiş gün planı yok');
        return loadDayPlan(
          tx,
          secrets,
          tenantId,
          studentId,
          guardian.studentName,
          serviceDate,
          canGuardianViewDeliveryOtp({
            relationActive: true,
            canAuthorizeTempAddress: guardian.canAuthorizeTempAddress,
          }),
        );
      });
    },

    verifyDeliveryOtp(
      tenantId: string,
      actor: { membershipId: string; roles: string[]; deviceId: string | null },
      tripId: string,
      input: VerifyDeliveryOtpInput,
    ) {
      const role = actor.roles.includes('ADMIN')
        ? 'ADMIN'
        : actor.roles.includes('ATTENDANT')
          ? 'ATTENDANT'
          : 'DRIVER';
      return withActor(db, tenantId, actor.membershipId, role, async (tx) => {
        await assertOtpLive(tx);
        await assertCrewOnTrip(tx, tenantId, tripId, actor.membershipId, actor.roles);
        const [studentRow] = await tx
          .select({
            id: tripStudent.id,
            tripId: tripStudent.tripId,
            studentId: tripStudent.studentId,
            vehicleId: trip.currentVehicleId,
            serviceDate: trip.serviceDate,
          })
          .from(tripStudent)
          .innerJoin(trip, and(eq(trip.id, tripStudent.tripId), eq(trip.tenantId, tenantId)))
          .where(and(eq(tripStudent.id, input.tripStudentId), eq(tripStudent.tenantId, tenantId)));
        if (!studentRow || studentRow.tripId !== tripId)
          throw notFound('Öğrenci sefer kaydı bulunamadı');
        const [override] = await tx
          .select()
          .from(deliveryOverride)
          .where(
            and(
              eq(deliveryOverride.tenantId, tenantId),
              eq(deliveryOverride.studentId, studentRow.studentId),
              eq(deliveryOverride.serviceDate, asYmd(studentRow.serviceDate)),
              inArray(deliveryOverride.status, ['ACTIVE', 'LOCKED']),
            ),
          )
          .for('update');
        if (!override) throw notFound('Aktif farklı teslimat yok');
        if (override.status === 'LOCKED') {
          return { kind: 'locked' as const };
        }
        if (override.otpExpiresAt && override.otpExpiresAt.getTime() <= Date.now()) {
          await tx
            .update(deliveryOverride)
            .set({ status: 'EXPIRED', otpCiphertext: null, otpHmac: null })
            .where(
              and(eq(deliveryOverride.id, override.id), eq(deliveryOverride.tenantId, tenantId)),
            );
          return { kind: 'expired' as const };
        }
        const stored = asBuffer(override.otpHmac);
        if (!stored || !otpHmacMatches(input.code, secrets.pepper, stored)) {
          const bumped = firstRow(
            await tx.execute(sql`
              update delivery_override
              set
                attempt_count = attempt_count + 1,
                status = case
                  when attempt_count + 1 >= ${OTP_MAX_ATTEMPTS}
                    then 'LOCKED'::delivery_override_status
                  else status
                end,
                locked_until = case
                  when attempt_count + 1 >= ${OTP_MAX_ATTEMPTS} then now()
                  else locked_until
                end
              where tenant_id = ${tenantId}::uuid
                and id = ${override.id}::uuid
              returning attempt_count, status
            `),
          );
          if (!bumped) throw new HttpError(500, 'otp_attempt_failed', 'OTP denemesi yazılamadı');
          const attempts = Number(bumped['attempt_count'] ?? bumped['attemptCount'] ?? 0);
          return { kind: 'mismatch' as const, locked: otpLockedAfterAttempts(attempts) };
        }
        await tx.execute(sql`select set_config('app.delivery_otp_ok', 'on', true)`);
        await tx.execute(
          sql`select mark_delivery_verified(${override.id}::uuid, ${input.tripStudentId}::uuid)`,
        );
        await insertPlanEvent(tx, {
          tenantId,
          membershipId: actor.membershipId,
          role: role === 'ADMIN' ? 'ADMIN' : role === 'ATTENDANT' ? 'ATTENDANT' : 'DRIVER',
          tripId,
          vehicleId: studentRow.vehicleId,
          subjectType: 'TRIP_STUDENT',
          subjectId: input.tripStudentId,
          eventType: 'DELIVERY_OTP_VERIFIED',
          prevState: null,
          newState: 'VERIFIED',
        });
        return { kind: 'ok' as const, overrideId: override.id };
      }).then((outcome) => {
        switch (outcome.kind) {
          case 'ok':
            return { ok: true as const, overrideId: outcome.overrideId };
          case 'locked':
            throw conflict('otp_locked', 'Kod kilitli; yönetici onayı gerekir');
          case 'expired':
            throw conflict('otp_expired', 'Kodun süresi doldu');
          case 'mismatch':
            throw conflict(
              outcome.locked ? 'otp_locked' : 'otp_mismatch',
              outcome.locked ? 'Beş yanlış; kod kilitlendi' : 'Kod hatalı',
            );
          default:
            return exhaustive(outcome, 'verifyDeliveryOtp');
        }
      });
    },

    ackCriticalChange(
      tenantId: string,
      actor: { membershipId: string; roles: string[]; deviceId: string | null },
      tripId: string,
      alertId: string,
    ) {
      const role = actor.roles.includes('ADMIN')
        ? 'ADMIN'
        : actor.roles.includes('ATTENDANT')
          ? 'ATTENDANT'
          : 'DRIVER';
      return withActor(db, tenantId, actor.membershipId, role, async (tx) => {
        if (!actor.deviceId) throw badRequest('device_required', 'x-device-id zorunlu');
        await assertCrewOnTrip(tx, tenantId, tripId, actor.membershipId, actor.roles);
        const [alert] = await tx
          .select({ id: criticalChangeAlert.id, tripId: criticalChangeAlert.tripId })
          .from(criticalChangeAlert)
          .where(
            and(eq(criticalChangeAlert.id, alertId), eq(criticalChangeAlert.tenantId, tenantId)),
          );
        if (!alert || alert.tripId !== tripId) throw notFound('Uyarı bulunamadı');
        await tx
          .insert(criticalChangeAck)
          .values({
            tenantId,
            alertId,
            membershipId: actor.membershipId,
            deviceId: actor.deviceId,
          })
          .onConflictDoNothing();
        return { ok: true as const };
      });
    },

    createAddressChange(tenantId: string, membershipId: string, input: CreateAddressChangeInput) {
      return withActor(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        const guardian = await requireGuardian(tx, tenantId, membershipId, input.studentId);
        const zone = await tenantZone(tx, tenantId);
        const today = ymdInTimeZone(new Date(), zone);
        if (input.effectiveFromDate < today)
          throw badRequest('past_date', 'Geçmiş tarihli adres değişikliği yok');
        const baseline = await homeDropoff(tx, tenantId, input.studentId, today);
        const [addr] = await tx
          .insert(address)
          .values({
            tenantId,
            text: input.addressText,
            il: baseline?.il ?? 'İstanbul',
            ilce: baseline?.ilce ?? 'Kadıköy',
            lat: input.lat,
            lng: input.lng,
          })
          .returning({ id: address.id });
        if (!addr) throw new HttpError(500, 'insert_failed', 'Adres kaydedilemedi');
        const [row] = await tx
          .insert(addressChangeRequest)
          .values({
            tenantId,
            studentId: input.studentId,
            proposedAddressId: addr.id,
            status: 'PENDING',
            effectiveFromDate: input.effectiveFromDate,
          })
          .returning({
            id: addressChangeRequest.id,
            studentId: addressChangeRequest.studentId,
            status: addressChangeRequest.status,
            effectiveFromDate: addressChangeRequest.effectiveFromDate,
          });
        if (!row) throw new HttpError(500, 'insert_failed', 'Adres talebi yazılamadı');
        const view: AddressChangeView = {
          id: row.id,
          studentId: row.studentId,
          studentName: guardian.studentName,
          status: row.status,
          addressText: input.addressText,
          effectiveFromDate: String(row.effectiveFromDate).slice(0, 10),
        };
        return view;
      });
    },

    listAdminExceptions(tenantId: string, membershipId: string): Promise<AdminExceptionsList> {
      return withActor(db, tenantId, membershipId, 'ADMIN', async (tx) => {
        const zone = await tenantZone(tx, tenantId);
        const today = ymdInTimeZone(new Date(), zone);
        const exceptions = await tx
          .select({
            id: rideException.id,
            studentId: rideException.studentId,
            studentName: student.fullName,
            serviceDate: rideException.serviceDate,
            segment: rideException.segment,
            source: rideException.source,
            cancelledAt: rideException.cancelledAt,
          })
          .from(rideException)
          .innerJoin(
            student,
            and(eq(student.id, rideException.studentId), eq(student.tenantId, tenantId)),
          )
          .where(and(eq(rideException.tenantId, tenantId), gte(rideException.serviceDate, today)))
          .orderBy(desc(rideException.createdAt))
          .limit(200);
        const overrides = await tx
          .select({
            id: deliveryOverride.id,
            studentId: deliveryOverride.studentId,
            studentName: student.fullName,
            serviceDate: deliveryOverride.serviceDate,
            status: deliveryOverride.status,
            receiverName: deliveryOverride.receiverName,
            addressText: address.text,
            lat: address.lat,
            lng: address.lng,
          })
          .from(deliveryOverride)
          .innerJoin(
            student,
            and(eq(student.id, deliveryOverride.studentId), eq(student.tenantId, tenantId)),
          )
          .innerJoin(
            address,
            and(eq(address.id, deliveryOverride.addressId), eq(address.tenantId, tenantId)),
          )
          .where(
            and(eq(deliveryOverride.tenantId, tenantId), gte(deliveryOverride.serviceDate, today)),
          )
          .orderBy(desc(deliveryOverride.createdAt))
          .limit(200);
        const addressChanges = await tx
          .select({
            id: addressChangeRequest.id,
            studentId: addressChangeRequest.studentId,
            studentName: student.fullName,
            status: addressChangeRequest.status,
            addressText: address.text,
            effectiveFromDate: addressChangeRequest.effectiveFromDate,
          })
          .from(addressChangeRequest)
          .innerJoin(
            student,
            and(eq(student.id, addressChangeRequest.studentId), eq(student.tenantId, tenantId)),
          )
          .innerJoin(
            address,
            and(
              eq(address.id, addressChangeRequest.proposedAddressId),
              eq(address.tenantId, tenantId),
            ),
          )
          .where(
            and(
              eq(addressChangeRequest.tenantId, tenantId),
              or(
                eq(addressChangeRequest.status, 'PENDING'),
                gte(addressChangeRequest.effectiveFromDate, today),
              ),
            ),
          )
          .orderBy(desc(addressChangeRequest.createdAt))
          .limit(200);
        return {
          available: true as const,
          exceptions: exceptions.map((row) => ({
            id: row.id,
            studentId: row.studentId,
            studentName: row.studentName,
            serviceDate: asYmd(row.serviceDate),
            segment: row.segment,
            source: row.source,
            cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
          })),
          overrides: await Promise.all(
            overrides.map(async (row) => {
              const serviceDate = asYmd(row.serviceDate);
              const baseline = await homeDropoff(tx, tenantId, row.studentId, serviceDate);
              const maxDetourM = await routeMaxDetour(tx, tenantId, row.studentId);
              const detourM = baseline
                ? Math.round(
                    haversineMeters(
                      { lat: baseline.lat, lng: baseline.lng },
                      { lat: row.lat, lng: row.lng },
                    ),
                  )
                : 0;
              const view: AdminDeliveryOverrideView = {
                id: row.id,
                studentId: row.studentId,
                studentName: row.studentName,
                serviceDate,
                status: row.status,
                receiverName: row.receiverName,
                addressText: row.addressText,
                detourM,
                maxDetourM,
              };
              return view;
            }),
          ),
          addressChanges: addressChanges.map((row) => ({
            id: row.id,
            studentId: row.studentId,
            studentName: row.studentName,
            status: row.status,
            addressText: row.addressText,
            effectiveFromDate: String(row.effectiveFromDate).slice(0, 10),
          })),
        };
      });
    },

    approveDeliveryOverride(tenantId: string, membershipId: string, overrideId: string) {
      return withActor(db, tenantId, membershipId, 'ADMIN', async (tx) => {
        await assertOtpLive(tx);
        const [row] = await tx
          .select()
          .from(deliveryOverride)
          .where(and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)));
        if (!row) throw notFound('Teslim talebi bulunamadı');
        if (row.status !== 'PENDING_APPROVAL')
          throw conflict('override_not_pending', 'Onay bekleyen talep yok');
        const [named] = await tx
          .select({ fullName: student.fullName })
          .from(student)
          .where(and(eq(student.id, row.studentId), eq(student.tenantId, tenantId)));
        const [addr] = await tx
          .select({ lat: address.lat, lng: address.lng, text: address.text })
          .from(address)
          .where(and(eq(address.id, row.addressId), eq(address.tenantId, tenantId)));
        if (!addr || !named) throw notFound('Teslim talebi bulunamadı');
        const zone = await tenantZone(tx, tenantId);
        const serviceDate = asYmd(row.serviceDate);
        const otp = issueOtp(secrets, serviceDate, zone);
        await tx
          .update(deliveryOverride)
          .set({
            status: 'ACTIVE',
            otpHmac: otp.hmac,
            otpCiphertext: otp.ciphertext,
            otpExpiresAt: otp.expiresAt,
          })
          .where(and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)));
        await applyOverrideToAfternoon(tx, {
          tenantId,
          membershipId,
          studentId: row.studentId,
          studentName: named.fullName,
          serviceDate,
          receiverName: row.receiverName,
          dropoff: { lat: addr.lat, lng: addr.lng, text: addr.text },
        });
        await notifyGuardians(
          tx,
          tenantId,
          row.studentId,
          'DELIVERY_OTP',
          `otp:${row.id}:0`,
          'SMS',
          { refId: row.id },
        );
        return { ok: true as const };
      });
    },

    rejectDeliveryOverride(tenantId: string, membershipId: string, overrideId: string) {
      return withActor(db, tenantId, membershipId, 'ADMIN', async (tx) => {
        const [row] = await tx
          .select({
            studentId: deliveryOverride.studentId,
            serviceDate: deliveryOverride.serviceDate,
            status: deliveryOverride.status,
          })
          .from(deliveryOverride)
          .where(and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)));
        if (!row) throw notFound('Teslim talebi bulunamadı');
        if (row.status !== 'PENDING_APPROVAL')
          throw conflict('override_not_pending', 'Reddedilecek bekleyen talep yok');
        await tx
          .update(deliveryOverride)
          .set({ status: 'CANCELLED', otpCiphertext: null })
          .where(and(eq(deliveryOverride.id, overrideId), eq(deliveryOverride.tenantId, tenantId)));
        return { ok: true as const };
      });
    },

    adminOverrideDelivery(
      tenantId: string,
      membershipId: string,
      overrideId: string,
      input: AdminOverrideDeliveryInput,
    ) {
      return withActor(db, tenantId, membershipId, 'ADMIN', async (tx) => {
        await tx.execute(
          sql`select admin_override_delivery(${overrideId}::uuid, ${input.tripStudentId}::uuid, ${input.reason})`,
        );
        return { ok: true as const };
      });
    },

    approveAddressChange(tenantId: string, membershipId: string, requestId: string) {
      return withActor(db, tenantId, membershipId, 'ADMIN', async (tx) => {
        const [row] = await tx
          .select()
          .from(addressChangeRequest)
          .where(
            and(
              eq(addressChangeRequest.id, requestId),
              eq(addressChangeRequest.tenantId, tenantId),
            ),
          );
        if (!row) throw notFound('Adres talebi bulunamadı');
        if (row.status !== 'PENDING') throw conflict('request_not_pending', 'Bekleyen talep yok');
        const effective = String(row.effectiveFromDate).slice(0, 10);
        const [year, month, day] = effective.split('-').map(Number);
        const prev = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - 1))
          .toISOString()
          .slice(0, 10);
        for (const usage of ['PICKUP', 'DROPOFF'] as const) {
          await tx
            .update(studentAddress)
            .set({ validTo: prev })
            .where(
              and(
                eq(studentAddress.tenantId, tenantId),
                eq(studentAddress.studentId, row.studentId),
                eq(studentAddress.usage, usage),
                isNull(studentAddress.validTo),
              ),
            );
          await tx.insert(studentAddress).values({
            tenantId,
            studentId: row.studentId,
            addressId: row.proposedAddressId,
            usage,
            validFrom: effective,
          });
        }
        await tx
          .update(addressChangeRequest)
          .set({ status: 'APPROVED' })
          .where(
            and(
              eq(addressChangeRequest.id, requestId),
              eq(addressChangeRequest.tenantId, tenantId),
            ),
          );
        return { ok: true as const };
      });
    },

    rejectAddressChange(tenantId: string, membershipId: string, requestId: string) {
      return withActor(db, tenantId, membershipId, 'ADMIN', async (tx) => {
        const [row] = await tx
          .select({ status: addressChangeRequest.status })
          .from(addressChangeRequest)
          .where(
            and(
              eq(addressChangeRequest.id, requestId),
              eq(addressChangeRequest.tenantId, tenantId),
            ),
          );
        if (!row) throw notFound('Adres talebi bulunamadı');
        if (row.status !== 'PENDING') throw conflict('request_not_pending', 'Bekleyen talep yok');
        await tx
          .update(addressChangeRequest)
          .set({ status: 'REJECTED' })
          .where(
            and(
              eq(addressChangeRequest.id, requestId),
              eq(addressChangeRequest.tenantId, tenantId),
            ),
          );
        return { ok: true as const };
      });
    },

    loadDayPlans(tenantId: string, membershipId: string, studentIds: string[]) {
      return withActor(db, tenantId, membershipId, 'GUARDIAN', async (tx) => {
        const zone = await tenantZone(tx, tenantId);
        const today = ymdInTimeZone(new Date(), zone);
        const map = new Map<string, ParentDayPlan>();
        for (const studentId of studentIds) {
          const guardian = await requireGuardian(tx, tenantId, membershipId, studentId);
          map.set(
            studentId,
            await loadDayPlan(
              tx,
              secrets,
              tenantId,
              studentId,
              guardian.studentName,
              today,
              canGuardianViewDeliveryOtp({
                relationActive: true,
                canAuthorizeTempAddress: guardian.canAuthorizeTempAddress,
              }),
            ),
          );
        }
        return map;
      });
    },
  };
}

async function loadDayPlan(
  tx: Database,
  secrets: OtpSecrets,
  tenantId: string,
  studentId: string,
  studentName: string,
  today: string,
  revealOtp: boolean,
): Promise<ParentDayPlan> {
  const exceptions = await tx
    .select({ id: rideException.id, segment: rideException.segment })
    .from(rideException)
    .where(
      and(
        eq(rideException.tenantId, tenantId),
        eq(rideException.studentId, studentId),
        eq(rideException.serviceDate, today),
        isNull(rideException.cancelledAt),
      ),
    );
  await tx
    .update(deliveryOverride)
    .set({ status: 'EXPIRED', otpCiphertext: null, otpHmac: null })
    .where(
      and(
        eq(deliveryOverride.tenantId, tenantId),
        eq(deliveryOverride.studentId, studentId),
        eq(deliveryOverride.serviceDate, today),
        eq(deliveryOverride.status, 'ACTIVE'),
        lte(deliveryOverride.otpExpiresAt, new Date()),
      ),
    );
  const [override] = await tx
    .select({
      id: deliveryOverride.id,
      studentId: deliveryOverride.studentId,
      serviceDate: deliveryOverride.serviceDate,
      status: deliveryOverride.status,
      receiverName: deliveryOverride.receiverName,
      ciphertext: deliveryOverride.otpCiphertext,
      addressText: address.text,
    })
    .from(deliveryOverride)
    .innerJoin(
      address,
      and(eq(address.id, deliveryOverride.addressId), eq(address.tenantId, tenantId)),
    )
    .where(
      and(
        eq(deliveryOverride.tenantId, tenantId),
        eq(deliveryOverride.studentId, studentId),
        eq(deliveryOverride.serviceDate, today),
        inArray(deliveryOverride.status, ['PENDING_APPROVAL', 'ACTIVE', 'LOCKED']),
      ),
    )
    .limit(1);
  let otpCode: string | null = null;
  if (revealOtp && override?.status === 'ACTIVE') {
    const packed = asBuffer(override.ciphertext);
    if (packed) {
      try {
        otpCode = decryptDeliveryOtp(packed, secrets.encryptionKey);
      } catch {
        throw new HttpError(500, 'otp_decrypt_failed', 'Teslim kodu çözülemedi');
      }
    }
  }
  return {
    morningAbsent: exceptions.some((row) => row.segment === 'MORNING'),
    eveningAbsent: exceptions.some((row) => row.segment === 'AFTERNOON'),
    morningExceptionId: exceptions.find((row) => row.segment === 'MORNING')?.id ?? null,
    eveningExceptionId: exceptions.find((row) => row.segment === 'AFTERNOON')?.id ?? null,
    deliveryOverride: override
      ? overrideToView(override, {
          studentName,
          addressText: override.addressText,
          detourM: 0,
          maxDetourM: 0,
          otpCode,
        })
      : null,
  };
}

export type ExceptionsPort = ReturnType<typeof createExceptionsPort>;
