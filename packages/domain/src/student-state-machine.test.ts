import { describe, expect, it } from 'vitest';
import { STUDENT_STATES, type StudentState } from './states.js';
import { STUDENT_ACTIONS, applyStudentAction } from './student-state-machine.js';

const base = {
  tripState: 'ACTIVE',
  actorRole: 'ATTENDANT',
  deliveryTarget: 'HOME',
  deliveryVerified: false,
} as const;

describe('öğrenci durum makinesi — kırmızı çizgiler', () => {
  it('farklı adrese teslim doğrulanmamış kodla TAMAMLANAMAZ', () => {
    const result = applyStudentAction({
      ...base,
      action: 'DELIVER',
      currentState: 'ON_BOARD',
      deliveryTarget: 'TEMP',
      deliveryVerified: false,
    });
    expect(result).toEqual({ ok: false, reason: 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE' });
  });

  it('farklı adrese teslim doğrulanmış kodla tamamlanır', () => {
    const result = applyStudentAction({
      ...base,
      action: 'DELIVER',
      currentState: 'ON_BOARD',
      deliveryTarget: 'TEMP',
      deliveryVerified: true,
    });
    expect(result).toEqual({ ok: true, nextState: 'DELIVERED' });
  });

  it('TEMP iken RETURN_HOME OTP bypass değildir', () => {
    expect(
      applyStudentAction({
        ...base,
        action: 'RETURN_HOME',
        currentState: 'ON_BOARD',
        deliveryTarget: 'TEMP',
        deliveryVerified: false,
      }),
    ).toEqual({ ok: false, reason: 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE' });
  });

  it('okul hedefinde RETURN_HOME yoktur', () => {
    expect(
      applyStudentAction({
        ...base,
        action: 'RETURN_HOME',
        currentState: 'ON_BOARD',
        deliveryTarget: 'SCHOOL',
      }),
    ).toEqual({ ok: false, reason: 'ILLEGAL_TRANSITION' });
  });

  it('kayıtlı ev adresine teslim kod istemez', () => {
    const result = applyStudentAction({ ...base, action: 'DELIVER', currentState: 'ON_BOARD' });
    expect(result).toEqual({ ok: true, nextState: 'DELIVERED' });
  });

  it('geç teslim çözümü de TEMP adreste kodu atlayamaz', () => {
    const result = applyStudentAction({
      ...base,
      action: 'RESOLVE_DELIVERED_LATE',
      currentState: 'DELIVERY_FAILED',
      actorRole: 'ADMIN',
      deliveryTarget: 'TEMP',
      deliveryVerified: false,
    });
    expect(result).toEqual({ ok: false, reason: 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE' });
  });

  it('teslim edilemeyen çocuğun akıbetine personel karar veremez', () => {
    for (const action of [
      'RESOLVE_DELIVERED_LATE',
      'RESOLVE_RETURNED_TO_SCHOOL',
      'RESOLVE_HANDED_TO_ADMIN',
    ] as const) {
      expect(applyStudentAction({ ...base, action, currentState: 'DELIVERY_FAILED' })).toEqual({
        ok: false,
        reason: 'ROLE_NOT_ALLOWED',
      });
    }
  });

  it('veli öğrenci durumunu işaretleyemez', () => {
    const result = applyStudentAction({
      ...base,
      action: 'BOARD',
      currentState: 'EXPECTED',
      actorRole: 'GUARDIAN',
    });
    expect(result).toEqual({ ok: false, reason: 'ROLE_NOT_ALLOWED' });
  });
});

describe('öğrenci durum makinesi — saha gerçekleri', () => {
  it('arkadan koşup yetişen çocuk NO_SHOW sonrası binebilir', () => {
    expect(applyStudentAction({ ...base, action: 'BOARD', currentState: 'NO_SHOW' })).toEqual({
      ok: true,
      nextState: 'ON_BOARD',
    });
  });

  it('veli iptal etmesine rağmen kapıda bekleyen çocuk bırakılmaz', () => {
    expect(
      applyStudentAction({ ...base, action: 'BOARD', currentState: 'ABSENT_PLANNED' }),
    ).toEqual({ ok: true, nextState: 'ON_BOARD' });
  });

  it('teslim başarısızlığı ikinci kez de kaydedilebilir', () => {
    expect(
      applyStudentAction({
        ...base,
        action: 'MARK_DELIVERY_FAILED',
        currentState: 'DELIVERY_FAILED',
      }),
    ).toEqual({ ok: true, nextState: 'DELIVERY_FAILED' });
  });

  it('sefer başlamadan öğrenci işaretlenemez', () => {
    expect(
      applyStudentAction({
        ...base,
        action: 'BOARD',
        currentState: 'EXPECTED',
        tripState: 'READY',
      }),
    ).toEqual({ ok: false, reason: 'TRIP_NOT_IN_REQUIRED_STATE' });
  });

  it('teslim edilmiş öğrenci tekrar bindirilemez', () => {
    expect(applyStudentAction({ ...base, action: 'BOARD', currentState: 'DELIVERED' })).toEqual({
      ok: false,
      reason: 'ILLEGAL_TRANSITION',
    });
  });

  it('aynı işlem iki cihazdan gelirse ikincisi ayırt edilebilir yanıt alır', () => {
    expect(applyStudentAction({ ...base, action: 'BOARD', currentState: 'ON_BOARD' })).toEqual({
      ok: false,
      reason: 'ALREADY_IN_TARGET_STATE',
    });
  });
});

describe('geçiş matrisi bütünlüğü', () => {
  it('hiçbir aksiyon-durum kombinasyonu çökmez', () => {
    for (const action of STUDENT_ACTIONS) {
      for (const currentState of STUDENT_STATES) {
        const result = applyStudentAction({ ...base, action, currentState, actorRole: 'ADMIN' });
        expect(typeof result.ok).toBe('boolean');
      }
    }
  });

  it('terminal durumlardan hiçbir personel aksiyonu çıkmaz', () => {
    const terminal: StudentState[] = ['DELIVERED', 'DELIVERED_LATE', 'RETURNED_HOME', 'MOVED_OUT'];
    for (const currentState of terminal) {
      for (const action of STUDENT_ACTIONS) {
        const result = applyStudentAction({ ...base, action, currentState, actorRole: 'ADMIN' });
        expect(result.ok, `${currentState} → ${action} izinli olmamalı`).toBe(false);
      }
    }
  });
});
