import { describe, expect, it } from 'vitest';
import {
  evaluateStudentUndo,
  guardianNotificationHolds,
  isUndoableStudentAction,
  isUndoableStudentTransition,
  UNDO_WINDOW_MS,
} from './student-undo.js';

const lastBoard = {
  eventType: 'STUDENT_STATE',
  prevState: 'EXPECTED',
  newState: 'ON_BOARD',
  sourceCommandId: 'cmd-1',
  isUndo: false,
  occurredAtMs: 1_000,
};

describe('öğrenci komutu geri alma', () => {
  it('son Bindi 10 dakika içinde EXPECTED\'e döner', () => {
    expect(
      evaluateStudentUndo({
        tripState: 'ACTIVE',
        currentState: 'ON_BOARD',
        targetClientEventId: 'cmd-1',
        lastEvent: lastBoard,
        nowMs: 1_000 + 60_000,
      }),
    ).toEqual({ ok: true, restoreState: 'EXPECTED' });
  });

  it('OTP doğrulaması geri alınamaz', () => {
    expect(
      evaluateStudentUndo({
        tripState: 'ACTIVE',
        currentState: 'ON_BOARD',
        targetClientEventId: 'cmd-1',
        lastEvent: { ...lastBoard, eventType: 'DELIVERY_OTP_VERIFIED' },
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: 'OTP_VERIFICATION_NOT_UNDOABLE' });
  });

  it('DELIVER geri alınamaz', () => {
    expect(
      isUndoableStudentTransition('ON_BOARD', 'DELIVERED'),
    ).toBe(false);
    expect(isUndoableStudentAction('DELIVER')).toBe(false);
    expect(
      evaluateStudentUndo({
        tripState: 'ACTIVE',
        currentState: 'DELIVERED',
        targetClientEventId: 'cmd-1',
        lastEvent: {
          ...lastBoard,
          prevState: 'ON_BOARD',
          newState: 'DELIVERED',
        },
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: 'UNDO_NOT_ALLOWED' });
  });

  it('sefer kapandıktan sonra ve 10 dakikadan sonra reddeder', () => {
    expect(
      evaluateStudentUndo({
        tripState: 'COMPLETED',
        currentState: 'ON_BOARD',
        targetClientEventId: 'cmd-1',
        lastEvent: lastBoard,
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: 'TRIP_NOT_IN_REQUIRED_STATE' });
    expect(
      evaluateStudentUndo({
        tripState: 'ACTIVE',
        currentState: 'ON_BOARD',
        targetClientEventId: 'cmd-1',
        lastEvent: lastBoard,
        nowMs: 1_000 + UNDO_WINDOW_MS + 1,
      }),
    ).toEqual({ ok: false, reason: 'UNDO_WINDOW_EXPIRED' });
  });

  it('hedef henüz yoksa 404 değil, beklemeye düşer', () => {
    expect(
      evaluateStudentUndo({
        tripState: 'ACTIVE',
        currentState: 'EXPECTED',
        targetClientEventId: 'cmd-1',
        lastEvent: null,
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: 'TARGET_NOT_APPLIED' });
  });

  it('son işlem başka komutsa reddeder', () => {
    expect(
      evaluateStudentUndo({
        tripState: 'ACTIVE',
        currentState: 'ON_BOARD',
        targetClientEventId: 'eski',
        lastEvent: lastBoard,
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: 'NOT_LAST_ACTION' });
  });

  it('veli durum bildirimi gecikir, düzeltme gecikmez', () => {
    expect(guardianNotificationHolds('STUDENT_ON_BOARD')).toBe(true);
    expect(guardianNotificationHolds('STUDENT_STATE_CORRECTED')).toBe(false);
    expect(guardianNotificationHolds('APPROACH')).toBe(false);
  });
});
