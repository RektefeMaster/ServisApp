import {
  alertSeverity,
  deliveryTarget,
  devicePlatform,
  exceptionSource,
  guardianRelationStatus,
  handoverPolicy,
  importRowStatus,
  inviteStatus,
  locationQuality,
  membershipStatus,
  overrideStatus,
  requestStatus,
  routeVersionStatus,
  schoolLevel,
  stopKind,
  studentState,
  tripSegment,
  tripState,
  vehicleCheckPhase,
} from '@servisapp/contracts';
import {
  addressUsageEnum,
  alertSeverityEnum,
  deliveryTargetEnum,
  devicePlatformEnum,
  exceptionSourceEnum,
  guardianRelationStatusEnum,
  handoverPolicyEnum,
  importRowStatusEnum,
  inviteStatusEnum,
  locationQualityEnum,
  membershipStatusEnum,
  overrideStatusEnum,
  requestStatusEnum,
  routeVersionStatusEnum,
  schoolLevelEnum,
  segmentEnum,
  stopKindEnum,
  studentStateEnum,
  tripStateEnum,
  vehicleCheckPhaseEnum,
} from '@servisapp/db';
import { DELIVERY_TARGETS, STUDENT_STATES, TRIP_STATES } from '@servisapp/domain';
import { describe, expect, it } from 'vitest';

/**
 * Aynı kavram üç yerde tanımlıdır: veritabanı enum'u, zod sözleşmesi ve domain
 * birliği. Biri diğerinden ayrılırsa hata derleme zamanında görünmez — üretimde
 * "invalid input value for enum" olarak patlar ya da daha kötüsü, istemcinin
 * hiç tanımadığı bir değer sessizce ekrana düşer. Bu test üçünü kilitler.
 */
function values(schema: { options: readonly string[] }): string[] {
  return [...schema.options];
}

describe('enum hizası: veritabanı ↔ sözleşme', () => {
  const pairs: Array<[string, readonly string[], readonly string[]]> = [
    ['trip_state', tripStateEnum.enumValues, values(tripState)],
    ['student_state', studentStateEnum.enumValues, values(studentState)],
    ['delivery_target', deliveryTargetEnum.enumValues, values(deliveryTarget)],
    ['trip_segment', segmentEnum.enumValues, values(tripSegment)],
    ['stop_kind', stopKindEnum.enumValues, values(stopKind)],
    ['school_level', schoolLevelEnum.enumValues, values(schoolLevel)],
    ['handover_policy', handoverPolicyEnum.enumValues, values(handoverPolicy)],
    ['route_version_status', routeVersionStatusEnum.enumValues, values(routeVersionStatus)],
    ['override_status', overrideStatusEnum.enumValues, values(overrideStatus)],
    ['vehicle_check_phase', vehicleCheckPhaseEnum.enumValues, values(vehicleCheckPhase)],
    ['location_quality', locationQualityEnum.enumValues, values(locationQuality)],
    ['exception_source', exceptionSourceEnum.enumValues, values(exceptionSource)],
    ['request_status', requestStatusEnum.enumValues, values(requestStatus)],
    ['membership_status', membershipStatusEnum.enumValues, values(membershipStatus)],
    ['device_platform', devicePlatformEnum.enumValues, values(devicePlatform)],
    ['alert_severity', alertSeverityEnum.enumValues, values(alertSeverity)],
    [
      'guardian_relation_status',
      guardianRelationStatusEnum.enumValues,
      values(guardianRelationStatus),
    ],
    ['import_row_status', importRowStatusEnum.enumValues, values(importRowStatus)],
    ['invite_status', inviteStatusEnum.enumValues, values(inviteStatus)],
  ];

  for (const [name, dbValues, contractValues] of pairs) {
    it(`${name} iki tarafta aynı`, () => {
      expect([...dbValues].sort()).toEqual([...contractValues].sort());
    });
  }
});

describe('enum hizası: veritabanı ↔ domain', () => {
  it('sefer durumları', () => {
    expect(tripStateEnum.enumValues).toEqual([...TRIP_STATES]);
  });

  it('öğrenci durumları', () => {
    expect(studentStateEnum.enumValues).toEqual([...STUDENT_STATES]);
  });

  it('teslim hedefleri', () => {
    expect(deliveryTargetEnum.enumValues).toEqual([...DELIVERY_TARGETS]);
  });
});

describe('adres kullanımı durak türünün alt kümesidir', () => {
  it('PICKUP ve DROPOFF durak türlerinde de vardır', () => {
    for (const usage of addressUsageEnum.enumValues) {
      expect(stopKindEnum.enumValues).toContain(usage);
    }
  });
});
