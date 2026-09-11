import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Durumlar DB seviyesinde de enum'dur: uygulamada bir yazım hatası olsa bile
 * geçersiz bir durum satıra yazılamaz. Değerler packages/domain ile birebir
 * aynıdır; sapma olursa tip testi yakalar.
 */
export const tripStateEnum = pgEnum('trip_state', [
  'PLANNED',
  'READY',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'SUSPENDED',
  'ABORTED',
  'AUTO_CLOSED',
]);

export const studentStateEnum = pgEnum('student_state', [
  'EXPECTED',
  'ON_BOARD',
  'DELIVERED',
  'ABSENT_PLANNED',
  'NO_SHOW',
  'MOVED_OUT',
  'DELIVERY_FAILED',
  'DELIVERED_LATE',
  'RETURNED_TO_SCHOOL',
  'HANDED_TO_ADMIN',
  'RETURNED_HOME',
]);

export const deliveryTargetEnum = pgEnum('delivery_target', ['SCHOOL', 'HOME', 'TEMP']);
export const deliveryMethodEnum = pgEnum('delivery_method', [
  'HOME_NO_CODE',
  'OTP',
  'ADMIN_OVERRIDE',
]);

export const roleEnum = pgEnum('membership_role_name', [
  'ADMIN',
  'DRIVER',
  'ATTENDANT',
  'GUARDIAN',
]);
export const actorRoleEnum = pgEnum('actor_role', [
  'ADMIN',
  'DRIVER',
  'ATTENDANT',
  'GUARDIAN',
  'SYSTEM',
]);
export const crewRoleEnum = pgEnum('crew_role', ['DRIVER', 'ATTENDANT']);
export const segmentEnum = pgEnum('trip_segment', ['MORNING', 'AFTERNOON']);
export const stopKindEnum = pgEnum('stop_kind', ['PICKUP', 'DROPOFF', 'SCHOOL']);
export const addressUsageEnum = pgEnum('address_usage', ['PICKUP', 'DROPOFF']);
export const schoolLevelEnum = pgEnum('school_level', [
  'PRESCHOOL',
  'PRIMARY',
  'SECONDARY',
  'HIGH',
]);
export const handoverPolicyEnum = pgEnum('handover_policy', [
  'GUARDIAN_REQUIRED',
  'MAY_LEAVE_ALONE',
]);
export const routeVersionStatusEnum = pgEnum('route_version_status', [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
]);
export const calendarDayTypeEnum = pgEnum('calendar_day_type', [
  'SCHOOL_DAY',
  'HOLIDAY',
  'HALF_DAY',
]);
export const overrideStatusEnum = pgEnum('delivery_override_status', [
  'PENDING_APPROVAL',
  'ACTIVE',
  'VERIFIED',
  'CANCELLED',
  'EXPIRED',
  'LOCKED',
]);
export const commandStatusEnum = pgEnum('command_status', [
  'PENDING',
  'APPLIED',
  'CONFLICT',
  'REJECTED',
]);
export const tripStudentOriginEnum = pgEnum('trip_student_origin', [
  'FROM_ROUTE',
  'MOVED_IN',
  'ADDED_BY_ADMIN',
]);
export const vehicleCheckPhaseEnum = pgEnum('vehicle_check_phase', ['BEFORE', 'AFTER']);
export const locationQualityEnum = pgEnum('location_quality', ['GOOD', 'LOW', 'REJECTED']);
export const exceptionSourceEnum = pgEnum('exception_source', ['PARENT', 'STAFF', 'ADMIN']);
export const requestStatusEnum = pgEnum('request_status', ['PENDING', 'APPROVED', 'REJECTED']);
export const notificationChannelEnum = pgEnum('notification_channel', ['PUSH', 'SMS']);
export const notificationStatusEnum = pgEnum('notification_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'CANCELLED',
]);
export const membershipStatusEnum = pgEnum('membership_status', [
  'ACTIVE',
  'INVITED',
  'SUSPENDED',
  'REVOKED',
]);
export const devicePlatformEnum = pgEnum('device_platform', ['IOS', 'ANDROID']);
export const alertSeverityEnum = pgEnum('alert_severity', ['INFO', 'WARNING', 'CRITICAL']);
export const guardianRelationStatusEnum = pgEnum('guardian_relation_status', ['ACTIVE', 'REVOKED']);
export const importRowStatusEnum = pgEnum('import_row_status', [
  'PENDING',
  'READY',
  'NEEDS_FIX',
  'ADDRESS_UNVERIFIED',
  'COMMITTED',
  'FAILED',
]);
export const inviteStatusEnum = pgEnum('invite_status', [
  'PENDING',
  'USED',
  'EXPIRED',
  'REVOKED',
]);
