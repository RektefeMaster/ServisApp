import { describe, expect, it } from 'vitest';
import type { StudentState } from './states.js';
import { occupiesVehicle } from './states.js';
import { canTransitionTrip } from './trip-state-machine.js';

const base = {
  actorRole: 'DRIVER',
  vehicleSweepConfirmed: true,
  studentStates: [] as readonly StudentState[],
} as const;

describe('sefer kapanışı — ürünün en önemli invariantı', () => {
  it('araçta öğrenci varken sefer KAPATILAMAZ', () => {
    expect(
      canTransitionTrip({ ...base, from: 'ACTIVE', to: 'COMPLETED', studentStates: ['ON_BOARD'] }),
    ).toEqual({ ok: false, reason: 'STUDENTS_STILL_ON_TRIP' });
  });

  it('daha alınmamış öğrenci varken sefer kapatılamaz', () => {
    expect(
      canTransitionTrip({ ...base, from: 'ACTIVE', to: 'COMPLETED', studentStates: ['EXPECTED'] }),
    ).toEqual({ ok: false, reason: 'STUDENTS_STILL_ON_TRIP' });
  });

  it('çözülmemiş teslim başarısızlığı varken sefer kapatılamaz', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'ACTIVE',
        to: 'COMPLETED',
        studentStates: ['DELIVERED', 'DELIVERY_FAILED'],
      }),
    ).toEqual({ ok: false, reason: 'STUDENTS_STILL_ON_TRIP' });
  });

  it('sefer sonu boş kontrolü yalnız araçtaki çocuk varken yalan olur', () => {
    expect(occupiesVehicle('ON_BOARD')).toBe(true);
    expect(occupiesVehicle('DELIVERY_FAILED')).toBe(true);
    expect(occupiesVehicle('EXPECTED')).toBe(false);
    expect(occupiesVehicle('NO_SHOW')).toBe(false);
    expect(occupiesVehicle('DELIVERED')).toBe(false);
  });

  it('araç içi kontrol onaylanmadan sefer kapatılamaz', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'ACTIVE',
        to: 'COMPLETED',
        vehicleSweepConfirmed: false,
        studentStates: ['DELIVERED'],
      }),
    ).toEqual({ ok: false, reason: 'VEHICLE_SWEEP_NOT_CONFIRMED' });
  });

  it('herkes teslim edilmiş ve araç kontrol edilmişse kapanır', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'ACTIVE',
        to: 'COMPLETED',
        studentStates: ['DELIVERED', 'ABSENT_PLANNED', 'NO_SHOW', 'MOVED_OUT'],
      }),
    ).toEqual({ ok: true });
  });

  it('sistem seferi COMPLETED yazamaz — yalnız AUTO_CLOSED', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'ACTIVE',
        to: 'COMPLETED',
        actorRole: 'SYSTEM',
        studentStates: ['ON_BOARD'],
      }),
    ).toEqual({ ok: false, reason: 'ROLE_NOT_ALLOWED' });
    expect(
      canTransitionTrip({
        ...base,
        from: 'ACTIVE',
        to: 'AUTO_CLOSED',
        actorRole: 'SYSTEM',
        studentStates: ['NO_SHOW'],
      }),
    ).toEqual({ ok: true });
  });

  it('AUTO_CLOSED araçtaki çocukla kapanamaz', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'ACTIVE',
        to: 'AUTO_CLOSED',
        actorRole: 'SYSTEM',
        studentStates: ['ON_BOARD'],
      }),
    ).toEqual({ ok: false, reason: 'STUDENTS_STILL_ON_TRIP' });
  });

  it('ABORTED çözülmemiş öğrenciyle kapanamaz', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'ACTIVE',
        to: 'ABORTED',
        actorRole: 'ADMIN',
        studentStates: ['EXPECTED'],
      }),
    ).toEqual({ ok: false, reason: 'STUDENTS_STILL_ON_TRIP' });
  });
});

describe('sefer iptali', () => {
  it('başlamamış sefer iptal edilebilir (tatil, kar)', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'READY',
        to: 'CANCELLED',
        actorRole: 'ADMIN',
        studentStates: ['EXPECTED', 'EXPECTED'],
      }),
    ).toEqual({ ok: true });
  });

  it('yaşanmış sefer iptal edilemez — ABORT gerekir', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'READY',
        to: 'CANCELLED',
        actorRole: 'ADMIN',
        studentStates: ['ON_BOARD'],
      }),
    ).toEqual({ ok: false, reason: 'STUDENTS_STILL_ON_TRIP' });
  });

  it('sefer iptalini personel yapamaz', () => {
    expect(
      canTransitionTrip({ ...base, from: 'READY', to: 'CANCELLED', actorRole: 'DRIVER' }),
    ).toEqual({ ok: false, reason: 'ROLE_NOT_ALLOWED' });
  });
});

describe('sefer yaşam döngüsü', () => {
  it('kapanmış sefer yeniden açılamaz', () => {
    for (const to of ['ACTIVE', 'READY', 'PLANNED'] as const) {
      expect(canTransitionTrip({ ...base, from: 'COMPLETED', to, actorRole: 'ADMIN' })).toEqual({
        ok: false,
        reason: 'ILLEGAL_TRANSITION',
      });
    }
  });

  it('arıza sonrası askıya alınan sefer devam edebilir', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'SUSPENDED',
        to: 'ACTIVE',
        actorRole: 'ADMIN',
        studentStates: ['ON_BOARD'],
      }),
    ).toEqual({ ok: true });
  });

  it('yapısal değişiklik READY seferi PLANNED durumuna döndürebilir', () => {
    expect(
      canTransitionTrip({ ...base, from: 'READY', to: 'PLANNED', actorRole: 'SYSTEM' }),
    ).toEqual({ ok: true });
  });

  it('READY sefer COMPLETED olamaz', () => {
    expect(
      canTransitionTrip({
        ...base,
        from: 'READY',
        to: 'COMPLETED',
        actorRole: 'ADMIN',
        vehicleSweepConfirmed: true,
        studentStates: ['DELIVERED'],
      }),
    ).toEqual({ ok: false, reason: 'ILLEGAL_TRANSITION' });
  });
});
