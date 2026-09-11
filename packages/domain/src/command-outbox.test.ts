import { describe, expect, it } from 'vitest';
import {
  applyOptimistic,
  applyServerResult,
  dropPendingForStudent,
  nextDeviceSeq,
  nextFlushBatch,
  recoverInFlight,
  reconcileStudentFromServer,
  type OutboxItem,
} from './command-outbox.js';
import type { CrewStudent } from './crew-focus.js';

const efe: CrewStudent = {
  id: 'ts-efe',
  studentId: 'efe',
  fullName: 'Efe Demir',
  state: 'EXPECTED',
  stateSeq: 0,
  deliveryTarget: 'SCHOOL',
  deliveryVerified: false,
  expectedStopId: 'home',
  needsReview: false,
};

function item(overrides: Partial<OutboxItem>): OutboxItem {
  return {
    clientEventId: '11111111-1111-4111-8111-111111111111',
    tripId: 'trip',
    tripStudentId: 'ts-efe',
    action: 'BOARD',
    expectedStateSeq: 0,
    deviceSeq: 0,
    occurredAtDevice: '2026-09-10T04:10:00.000Z',
    status: 'PENDING',
    ...overrides,
  };
}

describe('çevrimdışı komut kuyruğu', () => {
  it('iyimser bindirme state_seq artırır; yasadışı teslimi reddeder', () => {
    const boarded = applyOptimistic(efe, 'BOARD', 'ACTIVE', 'DRIVER');
    expect(boarded).toMatchObject({
      ok: true,
      student: { state: 'ON_BOARD', stateSeq: 1 },
    });
    expect(applyOptimistic(efe, 'DELIVER', 'ACTIVE', 'DRIVER')).toEqual({
      ok: false,
      reason: 'ILLEGAL_TRANSITION',
    });
  });

  it('CAS çatışmasında kuyruk durur, sonraki komut aynı öğrenci için gitmez', () => {
    const queued = [
      item({ deviceSeq: 0, status: 'CONFLICT', conflictState: 'ON_BOARD', conflictStateSeq: 1 }),
      item({
        clientEventId: '22222222-2222-4222-8222-222222222222',
        action: 'DELIVER',
        expectedStateSeq: 1,
        deviceSeq: 1,
      }),
      item({
        clientEventId: '33333333-3333-4333-8333-333333333333',
        tripStudentId: 'ts-ada',
        deviceSeq: 2,
      }),
    ];
    expect(nextFlushBatch(queued).map((row) => row.tripStudentId)).toEqual(['ts-ada']);
    const dropped = dropPendingForStudent(queued, 'ts-efe');
    expect(dropped.filter((row) => row.tripStudentId === 'ts-efe')).toHaveLength(1);
  });

  it('sunucu APPLIED/CONFLICT/REJECTED sonuçlarını ayrı tutar', () => {
    expect(
      applyServerResult(item({ status: 'IN_FLIGHT' }), {
        replay: false,
        status: 'APPLIED',
        tripStudentId: 'ts-efe',
        state: 'ON_BOARD',
        stateSeq: 1,
      }).status,
    ).toBe('APPLIED');
    const conflict = applyServerResult(item({ status: 'IN_FLIGHT' }), {
      replay: false,
      status: 'CONFLICT',
      tripStudentId: 'ts-efe',
      state: 'NO_SHOW',
      stateSeq: 1,
      reason: 'STUDENT_STATE_CONFLICT',
    });
    expect(conflict).toMatchObject({
      status: 'CONFLICT',
      conflictState: 'NO_SHOW',
      conflictStateSeq: 1,
    });
    expect(
      reconcileStudentFromServer(efe, { state: 'NO_SHOW', stateSeq: 1 }, true),
    ).toMatchObject({ state: 'NO_SHOW', stateSeq: 1, needsReview: true });
  });

  it('device_seq boşluksuz artar', () => {
    expect(nextDeviceSeq([])).toBe(0);
    expect(nextDeviceSeq([item({ deviceSeq: 3 }), item({ deviceSeq: 1 })])).toBe(4);
  });

  it('IN_FLIGHT komutu açılışta PENDING yapar; REJECTED aynı öğrencinin kuyruğunu durdurur', () => {
    expect(recoverInFlight([item({ status: 'IN_FLIGHT' })])[0]?.status).toBe('PENDING');
    const queued = [
      item({ status: 'REJECTED', rejectReason: 'TRIP_NOT_IN_REQUIRED_STATE' }),
      item({
        clientEventId: '22222222-2222-4222-8222-222222222222',
        action: 'DELIVER',
        expectedStateSeq: 1,
        deviceSeq: 1,
      }),
      item({
        clientEventId: '33333333-3333-4333-8333-333333333333',
        tripStudentId: 'ts-ada',
        deviceSeq: 2,
      }),
    ];
    expect(nextFlushBatch(queued).map((row) => row.tripStudentId)).toEqual(['ts-ada']);
  });
});
