import { describe, expect, it } from 'vitest';
import { reconcileStudent } from './reconcile.js';

describe('reconcile — plan ile operasyon gerçeği sınırı', () => {
  it('beklenen öğrenci için istisna planı günceller', () => {
    expect(reconcileStudent('EXPECTED', 'RIDE_EXCEPTION')).toEqual({
      kind: 'APPLY',
      nextState: 'ABSENT_PLANNED',
    });
  });

  it('çocuk araçtayken "bugün binmeyecek" reddedilir, teslim akışına yönlenir', () => {
    expect(reconcileStudent('ON_BOARD', 'RIDE_EXCEPTION')).toEqual({
      kind: 'REJECT',
      redirectTo: 'DELIVERY_CHANGE_REQUEST',
    });
  });

  it('çocuk araçtayken başka araca aktarım yönetici kararına düşer', () => {
    expect(reconcileStudent('ON_BOARD', 'STUDENT_TRIP_MOVE')).toEqual({
      kind: 'REJECT',
      redirectTo: 'ADMIN_DECISION',
    });
  });

  it('teslim edilmiş öğrencinin operasyon kaydı hiçbir istisnayla değişmez', () => {
    for (const state of ['DELIVERED', 'DELIVERED_LATE', 'RETURNED_TO_SCHOOL'] as const) {
      expect(reconcileStudent(state, 'RIDE_EXCEPTION')).toEqual({
        kind: 'IGNORE',
        reason: 'OPERATIONAL_FACT_WINS',
      });
    }
  });

  it('kapıda bulunamamış öğrenci için gelen istisna sessizce ezmez, işaretler', () => {
    expect(reconcileStudent('NO_SHOW', 'RIDE_EXCEPTION')).toEqual({
      kind: 'FLAG_FOR_REVIEW',
      reason: 'CONTRADICTS_FIELD_OBSERVATION',
    });
  });

  it('aynı istisna ikinci kez çalıştığında değişiklik üretmez (idempotent)', () => {
    expect(reconcileStudent('ABSENT_PLANNED', 'RIDE_EXCEPTION')).toEqual({
      kind: 'IGNORE',
      reason: 'OPERATIONAL_FACT_WINS',
    });
  });

  it('beklenen öğrenci için farklı teslimat hedefi TEMP olur, state değişmez', () => {
    expect(reconcileStudent('EXPECTED', 'DELIVERY_OVERRIDE')).toEqual({
      kind: 'APPLY_TARGET',
      deliveryTarget: 'TEMP',
    });
  });

  it('çocuk araçtayken farklı teslimat operasyonu ezmez', () => {
    expect(reconcileStudent('ON_BOARD', 'DELIVERY_OVERRIDE')).toEqual({
      kind: 'REJECT',
      redirectTo: 'DELIVERY_CHANGE_REQUEST',
    });
  });

  it('teslim edilmiş öğrenci için farklı teslimat yalnız bilgi olayıdır', () => {
    expect(reconcileStudent('DELIVERED', 'DELIVERY_OVERRIDE')).toEqual({
      kind: 'IGNORE',
      reason: 'OPERATIONAL_FACT_WINS',
    });
  });

  it('planlı yoklukta teslim hedefi TEMP olur', () => {
    expect(reconcileStudent('ABSENT_PLANNED', 'DELIVERY_OVERRIDE')).toEqual({
      kind: 'APPLY_TARGET',
      deliveryTarget: 'TEMP',
    });
  });

  it('kapıda yokken gelen farklı teslimat sessizce ezmez', () => {
    expect(reconcileStudent('NO_SHOW', 'DELIVERY_OVERRIDE')).toEqual({
      kind: 'FLAG_FOR_REVIEW',
      reason: 'CONTRADICTS_FIELD_OBSERVATION',
    });
  });
});
