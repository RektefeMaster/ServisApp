import type {
  CreateGuardianInput,
  CreateSchoolInput,
  CreateStaffInput,
  CreateStudentInput,
  CreateVehicleInput,
  PinAddressInput,
  PlatformConfig,
  SessionSnapshot,
} from '@servisapp/contracts';
import {
  address,
  createDbFromSql,
  membershipRole,
  school,
  staffAssignment,
  student,
  studentAddress,
  studentGuardian,
  tenantMembership,
  vehicle,
  withTenant,
  type Database,
} from '@servisapp/db';
import { and, eq, sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { conflict, HttpError } from '../http-error.js';
import { mapDbError } from './db-error.js';
import { createRouteAdminPort } from './route-admin.js';
import type { AdminPort, AppData, RouteAdminPort, SessionPort } from './ports.js';

interface SessionRow {
  identityId: string;
  fullName: string;
  phone: string;
  email: string | null;
  memberships: SessionSnapshot['memberships'];
}

type StaffOrGuardianRole = 'ADMIN' | 'DRIVER' | 'ATTENDANT' | 'GUARDIAN';

export function createPostgresData(sqlClient: postgres.Sql): AppData {
  const db = createDbFromSql(sqlClient);
  return {
    getPlatform: () => readPlatform(sqlClient),
    session: createSessionPort(sqlClient),
    admin: { ...createAdminPort(db), ...createRouteAdminPort(db) },
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

function createAdminPort(db: Database): Omit<AdminPort, keyof RouteAdminPort> {
  return {
    pinAddress(tenantId, input: PinAddressInput) {
      return withAdmin(db, tenantId, '', async (tx) => {
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
        const identityId = await ensureIdentityId(tx, input.phone, input.email, input.fullName);
        const membershipId = await attachMembership(tx, tenantId, identityId, input.role);

        if (input.vehicleId && input.role !== 'ADMIN') {
          await tx.insert(staffAssignment).values({
            tenantId,
            vehicleId: input.vehicleId,
            membershipId,
            role: input.role,
            validFrom: new Date(),
          });
        }

        return { identityId, membershipId };
      });
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
      return withAdmin(db, tenantId, '', async (tx) => {
        return tx
          .select({
            id: student.id,
            fullName: student.fullName,
            schoolId: student.schoolId,
          })
          .from(student);
      });
    },

    createGuardian(tenantId, studentId, input: CreateGuardianInput) {
      return withAdmin(db, tenantId, '', async (tx) => {
        const [existing] = await tx
          .select({ id: student.id })
          .from(student)
          .where(and(eq(student.id, studentId), eq(student.tenantId, tenantId)));
        if (!existing) throw new HttpError(404, 'not_found', 'Öğrenci bulunamadı');

        const identityId = await ensureIdentityId(tx, input.phone, null, input.fullName);
        const membershipId = await attachMembership(tx, tenantId, identityId, 'GUARDIAN');

        await tx.insert(studentGuardian).values({
          tenantId,
          studentId,
          guardianMembershipId: membershipId,
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
  };
}

async function ensureIdentityId(
  tx: Database,
  phone: string,
  email: string | null,
  fullName: string,
): Promise<string> {
  const result: unknown = await tx.execute(
    sql`select ensure_identity(${phone}::text, ${email}::text, ${fullName}::text) as id`,
  );
  const id = scalarId(result);
  if (!id) throw new HttpError(500, 'insert_failed', 'Kimlik kaydedilemedi');
  return id;
}

function scalarId(result: unknown): string | undefined {
  let rows: unknown;
  if (Array.isArray(result)) {
    rows = result;
  } else if (isRecord(result) && 'rows' in result) {
    rows = result['rows'];
  } else {
    return undefined;
  }
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const row: unknown = rows[0];
  if (!isRecord(row)) return undefined;
  const id = row['id'];
  return typeof id === 'string' ? id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function attachMembership(
  tx: Database,
  tenantId: string,
  identityId: string,
  role: StaffOrGuardianRole,
): Promise<string> {
  const [existing] = await tx
    .select({
      id: tenantMembership.id,
      status: tenantMembership.status,
    })
    .from(tenantMembership)
    .where(
      and(eq(tenantMembership.tenantId, tenantId), eq(tenantMembership.identityId, identityId)),
    );

  let membershipId: string;
  if (existing) {
    switch (existing.status) {
      case 'ACTIVE':
      case 'INVITED':
        membershipId = existing.id;
        break;
      case 'SUSPENDED':
      case 'REVOKED':
        throw conflict('membership_inactive', 'Bu kişi bu şirkette durdurulmuş veya çıkarılmış');
      default: {
        const unexpected: never = existing.status;
        void unexpected;
        throw new Error('unknown membership status');
      }
    }
  } else {
    const [created] = await tx
      .insert(tenantMembership)
      .values({
        tenantId,
        identityId,
        status: 'INVITED',
      })
      .returning({ id: tenantMembership.id });
    if (!created) throw new HttpError(500, 'insert_failed', 'Üyelik kaydedilemedi');
    membershipId = created.id;
  }

  await tx.insert(membershipRole).values({ tenantId, membershipId, role }).onConflictDoNothing();
  return membershipId;
}
