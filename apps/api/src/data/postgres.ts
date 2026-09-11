import type {
  CreateGuardianInput,
  CreateHolidayInput,
  CreateSchoolInput,
  CreateStaffInput,
  CreateStudentInput,
  CreateVehicleInput,
  PinAddressInput,
  PlatformConfig,
  SessionSnapshot,
} from '@servisapp/contracts';
import { hasUsableCoordinates, namesLikelySame } from '@servisapp/domain';
import {
  address,
  createDbFromSql,
  school,
  schoolCalendarDay,
  staffAssignment,
  student,
  studentAddress,
  tenantMembership,
  vehicle,
  withTenant,
  type Database,
} from '@servisapp/db';
import { and, eq, isNull } from 'drizzle-orm';
import type postgres from 'postgres';
import { HttpError } from '../http-error.js';
import { mapDbError } from './db-error.js';
import { attachMembership, ensureIdentityId, findIdentityByPhone, resolveGuardianIdentity } from './identity-write.js';
import { createOnboarding, type OnboardingOptions, upsertGuardianLink } from './onboarding.js';
import { loadParentChildren } from './plan-query.js';
import type { AdminPort, AppData, SessionPort, TripPort } from './ports.js';
import { createRouteAdminPort } from './route-admin.js';
import {
  endStudentTx,
  getStudentTx,
  listStaffTx,
  listStudentsTx,
  revokeGuardianTx,
} from './students-admin.js';
import { MemoryRealtimeTransport } from '../realtime/memory.js';
import { createTrackingPort } from './tracking.js';
import { createTripPort } from './trips.js';
import { createExceptionsPort } from './exceptions.js';

interface SessionRow {
  identityId: string;
  fullName: string;
  phone: string;
  email: string | null;
  memberships: SessionSnapshot['memberships'];
}

interface DevLoginRow {
  authUserId: string | null;
  identityId: string;
  fullName: string;
  phone: string;
  email: string;
  hasCrewRole: boolean;
}

interface DevParentRow {
  authUserId: string | null;
  identityId: string;
  fullName: string;
  phone: string;
  email: string | null;
}

const TEST_INVITE_PEPPER = 'test-pepper-en-az-otuziki-karakterxxxx';
const TEST_OTP_ENCRYPTION_KEY = 'test-key-en-az-otuziki-karakter-olmali-x';

interface PostgresDataOptions extends Partial<OnboardingOptions> {
  otpEncryptionKey?: string;
}

function resolveOnboardingOptions(options?: PostgresDataOptions): OnboardingOptions {
  const invitePepper =
    options?.invitePepper ??
    process.env['OTP_PEPPER'] ??
    (process.env['NODE_ENV'] === 'test' ? TEST_INVITE_PEPPER : '');
  if (invitePepper.length < 32) {
    throw new Error('OTP_PEPPER zorunlu (en az 32 karakter)');
  }
  return {
    invitePepper,
    publicAppUrl: (options?.publicAppUrl ?? process.env['ADMIN_PUBLIC_URL'] ?? '').replace(
      /\/$/,
      '',
    ),
    revealInviteSecrets: options?.revealInviteSecrets ?? false,
  };
}

function resolveOtpEncryptionKey(options?: PostgresDataOptions): string {
  const key =
    options?.otpEncryptionKey ??
    process.env['OTP_ENCRYPTION_KEY'] ??
    (process.env['NODE_ENV'] === 'test' ? TEST_OTP_ENCRYPTION_KEY : '');
  if (key.length < 32) {
    throw new Error('OTP_ENCRYPTION_KEY zorunlu (en az 32 karakter)');
  }
  return key;
}

export function createPostgresData(
  sqlClient: postgres.Sql,
  options?: PostgresDataOptions,
): AppData {
  const db = createDbFromSql(sqlClient);
  const realtime = new MemoryRealtimeTransport();
  const tracking = createTrackingPort(db, realtime);
  const onboardingOptions = resolveOnboardingOptions(options);
  const exceptions = createExceptionsPort(db, {
    pepper: onboardingOptions.invitePepper,
    encryptionKey: resolveOtpEncryptionKey(options),
  });
  const tripCore = createTripPort(db, {
    onClosed: (tripId) => realtime.publishEnded(tripId),
    ingest: (tenantId, actor, tripId, input) => tracking.ingest(tenantId, actor, tripId, input),
  });
  const trips: TripPort = {
    ...tripCore,
    verifyDeliveryOtp: (tenantId, actor, tripId, input) =>
      exceptions.verifyDeliveryOtp(tenantId, actor, tripId, input),
    ackCriticalChange: (tenantId, actor, tripId, alertId) =>
      exceptions.ackCriticalChange(tenantId, actor, tripId, alertId),
  };
  const onboarding = createOnboarding(db, onboardingOptions);
  const adminCore = createAdminPort(db);
  return {
    getPlatform: () => readPlatform(sqlClient),
    session: createSessionPort(sqlClient),
    trips,
    parent: {
      previewInvite: (token) => onboarding.previewInvite(token),
      activateInvite: (token, auth) => onboarding.activateInvite(token, auth),
      listChildren(tenantId, membershipId) {
        return withAdmin(db, tenantId, membershipId, async (tx) => {
          const [membership] = await tx
            .select({ status: tenantMembership.status })
            .from(tenantMembership)
            .where(
              and(eq(tenantMembership.id, membershipId), eq(tenantMembership.tenantId, tenantId)),
            );
          if (!membership) return [];
          return loadParentChildren(tx, tenantId, membershipId, membership.status);
        });
      },
      async getHome(tenantId, membershipId) {
        const home = await tracking.homeForParent(tenantId, membershipId);
        const plans = await exceptions.loadDayPlans(
          tenantId,
          membershipId,
          home.children.map((child) => child.studentId),
        );
        return {
          children: home.children.map((child) => ({
            ...child,
            day:
              plans.get(child.studentId) ?? {
                morningAbsent: false,
                eveningAbsent: false,
                morningExceptionId: null,
                eveningExceptionId: null,
                deliveryOverride: null,
              },
          })),
        };
      },
      pollTracking(tenantId, membershipId, tripId, studentId) {
        return tracking.pollForParent(tenantId, membershipId, tripId, studentId);
      },
      createRideException: (tenantId, membershipId, input) =>
        exceptions.createRideException(tenantId, membershipId, input),
      cancelRideException: (tenantId, membershipId, exceptionId) =>
        exceptions.cancelRideException(tenantId, membershipId, exceptionId),
      createDeliveryOverride: (tenantId, membershipId, input) =>
        exceptions.createDeliveryOverride(tenantId, membershipId, input),
      cancelDeliveryOverride: (tenantId, membershipId, overrideId) =>
        exceptions.cancelDeliveryOverride(tenantId, membershipId, overrideId),
      resendDeliveryOtp: (tenantId, membershipId, overrideId) =>
        exceptions.resendDeliveryOtp(tenantId, membershipId, overrideId),
      getParentDayPlan: (tenantId, membershipId, studentId, date) =>
        exceptions.getParentDayPlan(tenantId, membershipId, studentId, date),
      createAddressChange: (tenantId, membershipId, input) =>
        exceptions.createAddressChange(tenantId, membershipId, input),
    },
    admin: {
      ...adminCore,
      ...createRouteAdminPort(db),
      previewImport: (tenantId, actorMembershipId, input) =>
        onboarding.previewImport(tenantId, actorMembershipId, input),
      getImport: (tenantId, batchId) => onboarding.getImport(tenantId, batchId),
      commitImport: (tenantId, batchId, input) =>
        onboarding.commitImport(tenantId, batchId, input),
      createInvite: (tenantId, actorMembershipId, membershipId) =>
        onboarding.createInvite(tenantId, actorMembershipId, membershipId),
      sendInviteSms: (tenantId, inviteId) => onboarding.sendInviteSms(tenantId, inviteId),
      changeUnactivatedPhone: (tenantId, identityId, phone) =>
        onboarding.changeUnactivatedPhone(tenantId, identityId, phone),
      generateHorizon(tenantId, membershipId, input) {
        return trips.generateHorizon(tenantId, { membershipId, role: 'ADMIN' }, input);
      },
      listTripsForDate(tenantId, actor, date) {
        return trips.listForDate(tenantId, actor, date);
      },
      getTripDetail(tenantId, actor, tripId) {
        return trips.getDetail(tenantId, actor, tripId);
      },
      listEventsUnavailable: () => ({ items: [], available: false as const }),
      listExceptions: (tenantId, membershipId) =>
        exceptions.listAdminExceptions(tenantId, membershipId),
      approveDeliveryOverride: (tenantId, membershipId, overrideId) =>
        exceptions.approveDeliveryOverride(tenantId, membershipId, overrideId),
      rejectDeliveryOverride: (tenantId, membershipId, overrideId) =>
        exceptions.rejectDeliveryOverride(tenantId, membershipId, overrideId),
      adminOverrideDelivery: (tenantId, membershipId, overrideId, input) =>
        exceptions.adminOverrideDelivery(tenantId, membershipId, overrideId, input),
      approveAddressChange: (tenantId, membershipId, requestId) =>
        exceptions.approveAddressChange(tenantId, membershipId, requestId),
      rejectAddressChange: (tenantId, membershipId, requestId) =>
        exceptions.rejectAddressChange(tenantId, membershipId, requestId),
    },
    realtime: {
      vehicleBroadcasts: (tripId) => realtime.vehicleBroadcasts(tripId),
      endedTripIds: () => realtime.endedTripIds(),
      viewerCount: (tripId) => realtime.viewerCount(tripId),
    },
  };
}

async function readPlatform(sqlClient: postgres.Sql): Promise<PlatformConfig> {
  const [row] = await sqlClient<
    {
      schema_version: number;
      min_supported_app_version: string;
      kill_gps: boolean;
      kill_otp: boolean;
      kill_realtime: boolean;
      flags: Record<string, boolean>;
    }[]
  >`select schema_version, min_supported_app_version, kill_gps, kill_otp, kill_realtime, flags from platform_settings where id = true`;
  if (!row) {
    throw new HttpError(500, 'platform_settings_missing', 'Çalışma politikası okunamadı');
  }
  return {
    schemaVersion: row.schema_version,
    minSupportedAppVersion: row.min_supported_app_version,
    kills: {
      gps: row.kill_gps,
      otp: row.kill_otp,
      realtime: row.kill_realtime,
    },
    flags: row.flags ?? {},
  };
}

function createSessionPort(sqlClient: postgres.Sql): SessionPort {
  return {
    async resolve(input) {
      try {
        const [row] = await sqlClient<{ session: SessionRow }[]>`
          select resolve_session(
            ${input.authUserId}::uuid,
            ${input.phone},
            ${input.email}
          ) as session
        `;
        const session = row?.session;
        if (!session) {
          throw new HttpError(403, 'identity_not_provisioned', 'Bu hesap henüz tanımlanmamış');
        }
        return {
          identityId: session.identityId,
          fullName: session.fullName,
          phone: session.phone,
          email: session.email,
          memberships: session.memberships ?? [],
        };
      } catch (error) {
        mapDbError(error);
      }
    },

    async findDevLoginIdentity(email) {
      try {
        const [row] = await sqlClient<{ identity: DevLoginRow | null }[]>`
          select find_dev_login_identity(${email}) as identity
        `;
        const found = row?.identity;
        if (!found) return null;
        return {
          authUserId: found.authUserId,
          identityId: found.identityId,
          fullName: found.fullName,
          phone: found.phone,
          email: found.email,
          hasCrewRole: found.hasCrewRole,
        };
      } catch (error) {
        mapDbError(error);
      }
    },

    async findDevParentIdentity(phone) {
      try {
        const [row] = await sqlClient<{ identity: DevParentRow | null }[]>`
          select find_dev_parent_identity(${phone}) as identity
        `;
        const found = row?.identity;
        if (!found) return null;
        return {
          authUserId: found.authUserId,
          identityId: found.identityId,
          fullName: found.fullName,
          phone: found.phone,
          email: found.email,
        };
      } catch (error) {
        mapDbError(error);
      }
    },
  };
}

function adminCtx(tenantId: string, membershipId: string) {
  return { tenantId, membershipId, role: 'ADMIN' as const };
}

async function withAdmin<T>(
  db: Database,
  tenantId: string,
  membershipId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await withTenant(db, adminCtx(tenantId, membershipId), fn);
  } catch (error) {
    mapDbError(error);
  }
}

type SetupAdmin = Pick<
  AdminPort,
  | 'pinAddress'
  | 'listAddresses'
  | 'createSchool'
  | 'listSchools'
  | 'createVehicle'
  | 'listVehicles'
  | 'createStaff'
  | 'listStaff'
  | 'createStudent'
  | 'listStudents'
  | 'getStudent'
  | 'endStudent'
  | 'createGuardian'
  | 'revokeGuardian'
  | 'createHoliday'
>;

function createAdminPort(db: Database): SetupAdmin {
  return {
    pinAddress(tenantId: string, input: PinAddressInput) {
      return withAdmin(db, tenantId, '', async (tx) => {
        if (!hasUsableCoordinates(input.lat, input.lng)) {
          throw new HttpError(400, 'invalid_coordinates', 'Pin için geçerli koordinat gerekli');
        }
        const [row] = await tx
          .insert(address)
          .values({
            tenantId,
            text: input.text,
            il: input.il,
            ilce: input.ilce,
            lat: input.lat,
            lng: input.lng,
            geocodeConfidence: input.geocodeConfidence,
            verifiedAt: new Date(),
          })
          .returning({ id: address.id });
        if (!row) throw new HttpError(500, 'insert_failed', 'Adres kaydedilemedi');
        if (input.studentId) {
          await attachPinnedAddress(tx, tenantId, {
            studentId: input.studentId,
            addressId: row.id,
            usage: input.usage,
          });
        }
        return row;
      });
    },

    listAddresses(tenantId) {
      return withAdmin(db, tenantId, '', async (tx) => {
        const rows = await tx
          .select({
            id: address.id,
            text: address.text,
            lat: address.lat,
            lng: address.lng,
          })
          .from(address);
        return rows;
      });
    },

    createSchool(tenantId, input: CreateSchoolInput) {
      return withAdmin(db, tenantId, '', async (tx) => {
        const [row] = await tx
          .insert(school)
          .values({
            tenantId,
            name: input.name,
            level: input.level,
            addressId: input.addressId,
            attendantRequired: input.attendantRequired,
          })
          .returning({ id: school.id });
        if (!row) throw new HttpError(500, 'insert_failed', 'Okul kaydedilemedi');
        return row;
      });
    },

    listSchools(tenantId) {
      return withAdmin(db, tenantId, '', async (tx) => {
        return tx.select({ id: school.id, name: school.name, level: school.level }).from(school);
      });
    },

    createVehicle(tenantId, input: CreateVehicleInput) {
      return withAdmin(db, tenantId, '', async (tx) => {
        const [row] = await tx
          .insert(vehicle)
          .values({
            tenantId,
            plate: input.plate,
            seatCount: input.seatCount,
            modelYear: input.modelYear,
            inspectionExpiry: input.inspectionExpiry,
            insuranceExpiry: input.insuranceExpiry,
          })
          .returning({ id: vehicle.id });
        if (!row) throw new HttpError(500, 'insert_failed', 'Araç kaydedilemedi');
        return row;
      });
    },

    listVehicles(tenantId) {
      return withAdmin(db, tenantId, '', async (tx) => {
        return tx
          .select({
            id: vehicle.id,
            plate: vehicle.plate,
            seatCount: vehicle.seatCount,
          })
          .from(vehicle);
      });
    },

    createStaff(tenantId, actorMembershipId, input: CreateStaffInput) {
      return withAdmin(db, tenantId, actorMembershipId, async (tx) => {
        const existing = await findIdentityByPhone(tx, input.phone);
        let identityId: string;
        if (!existing) {
          identityId = await ensureIdentityId(tx, input.phone, input.email, input.fullName);
        } else if (namesLikelySame(existing.fullName, input.fullName)) {
          identityId = existing.id;
        } else {
          throw new HttpError(409, 'phone_in_use', 'Bu telefon mevcut bir kişide kullanılıyor');
        }
        const membershipId = await attachMembership(tx, tenantId, identityId, input.role);

        if (input.vehicleId && input.role !== 'ADMIN') {
          await tx.insert(staffAssignment).values({
            tenantId,
            vehicleId: input.vehicleId,
            membershipId,
            role: input.role,
            validFrom: input.validFrom
              ? new Date(`${input.validFrom}T00:00:00.000Z`)
              : new Date(),
          });
        }

        return { identityId, membershipId };
      });
    },

    listStaff(tenantId) {
      return withAdmin(db, tenantId, '', (tx) => listStaffTx(tx, tenantId));
    },

    createStudent(tenantId, input: CreateStudentInput) {
      return withAdmin(db, tenantId, '', async (tx) => {
        const [row] = await tx
          .insert(student)
          .values({
            tenantId,
            schoolId: input.schoolId,
            fullName: input.fullName,
            grade: input.grade,
            handoverPolicy: input.handoverPolicy,
            enrollmentStart: input.enrollmentStart,
            usesMorning: input.usesMorning,
            usesEvening: input.usesEvening,
          })
          .returning({ id: student.id });
        if (!row) throw new HttpError(500, 'insert_failed', 'Öğrenci kaydedilemedi');

        if (input.pickupAddressId) {
          await tx.insert(studentAddress).values({
            tenantId,
            studentId: row.id,
            addressId: input.pickupAddressId,
            usage: 'PICKUP',
            validFrom: input.enrollmentStart,
          });
        }
        if (input.dropoffAddressId) {
          await tx.insert(studentAddress).values({
            tenantId,
            studentId: row.id,
            addressId: input.dropoffAddressId,
            usage: 'DROPOFF',
            validFrom: input.enrollmentStart,
          });
        }
        return row;
      });
    },

    listStudents(tenantId) {
      return withAdmin(db, tenantId, '', (tx) => listStudentsTx(tx, tenantId));
    },

    getStudent(tenantId, studentId) {
      return withAdmin(db, tenantId, '', (tx) => getStudentTx(tx, tenantId, studentId));
    },

    endStudent(tenantId, studentId, enrollmentEnd) {
      return withAdmin(db, tenantId, '', (tx) => endStudentTx(tx, tenantId, studentId, enrollmentEnd));
    },

    createGuardian(tenantId, studentId, input: CreateGuardianInput) {
      return withAdmin(db, tenantId, '', async (tx) => {
        const [existing] = await tx
          .select({ id: student.id })
          .from(student)
          .where(and(eq(student.id, studentId), eq(student.tenantId, tenantId)));
        if (!existing) throw new HttpError(404, 'not_found', 'Öğrenci bulunamadı');

        const identityId = await resolveGuardianIdentity(tx, {
          phone: input.phone,
          fullName: input.fullName,
          reuseIdentityId: input.reuseIdentityId,
        });
        const membershipId = await attachMembership(tx, tenantId, identityId, 'GUARDIAN');
        await upsertGuardianLink(tx, {
          tenantId,
          studentId,
          membershipId,
          relation: input.relation,
          isPrimary: input.isPrimary,
          canReceiveChild: input.canReceiveChild,
          canAuthorizeTempAddress: input.canAuthorizeTempAddress,
          canSubmitException: input.canSubmitException,
          notifyAm: input.notifyAm,
          notifyPm: input.notifyPm,
        });

        return { identityId, membershipId };
      });
    },

    revokeGuardian(tenantId, studentId, membershipId) {
      return withAdmin(db, tenantId, '', (tx) =>
        revokeGuardianTx(tx, tenantId, studentId, membershipId),
      );
    },

    createHoliday(tenantId, schoolId, input: CreateHolidayInput) {
      return withAdmin(db, tenantId, '', async (tx) => {
        const [owned] = await tx
          .select({ id: school.id })
          .from(school)
          .where(and(eq(school.id, schoolId), eq(school.tenantId, tenantId)));
        if (!owned) throw new HttpError(404, 'not_found', 'Okul bulunamadı');
        await tx
          .insert(schoolCalendarDay)
          .values({
            tenantId,
            schoolId,
            date: input.date,
            type: 'HOLIDAY',
          })
          .onConflictDoNothing({
            target: [
              schoolCalendarDay.tenantId,
              schoolCalendarDay.schoolId,
              schoolCalendarDay.date,
            ],
          });
        return { schoolId, date: input.date, type: 'HOLIDAY' as const };
      });
    },
  };
}

async function attachPinnedAddress(
  tx: Database,
  tenantId: string,
  input: { studentId: string; addressId: string; usage?: 'PICKUP' | 'DROPOFF' },
): Promise<void> {
  const [owned] = await tx
    .select({ id: student.id })
    .from(student)
    .where(and(eq(student.id, input.studentId), eq(student.tenantId, tenantId)));
  if (!owned) throw new HttpError(404, 'not_found', 'Öğrenci bulunamadı');

  const usages: Array<'PICKUP' | 'DROPOFF'> = input.usage ? [input.usage] : ['PICKUP', 'DROPOFF'];
  const today = istanbulCalendarDate();
  const yesterday = previousCalendarDate(today);
  for (const usage of usages) {
    await tx
      .update(studentAddress)
      .set({ validTo: yesterday })
      .where(
        and(
          eq(studentAddress.tenantId, tenantId),
          eq(studentAddress.studentId, input.studentId),
          eq(studentAddress.usage, usage),
          isNull(studentAddress.validTo),
        ),
      );
    await tx.insert(studentAddress).values({
      tenantId,
      studentId: input.studentId,
      addressId: input.addressId,
      usage,
      validFrom: today,
    });
  }
}

function istanbulCalendarDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

function previousCalendarDate(ymd: string): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - 1);
  return new Date(utc).toISOString().slice(0, 10);
}
