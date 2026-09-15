import { describe, expect, it } from 'vitest';
import { mapDbError } from './db-error.js';
import { HttpError } from '../http-error.js';

/**
 * Veritabanı fonksiyonlarının `raise exception '<kod>'` ile attığı iş kuralı
 * hataları, kullanıcıya anlamlı HTTP yanıtına çevrilmek zorundadır. Eşleme
 * kaçarsa kullanıcı 500 görür ve gerçek sebep yalnız sunucu log'unda kalır.
 */
/**
 * drizzle'ın `tx.execute(sql...)` yolunda ürettiği hata: üst mesaj yalnız sorgu
 * ve parametreleri taşır, Postgres'in gerçek metni `cause` zincirindedir.
 */
function drizzleLike(pgMessage: string): Error {
  const cause = new Error(pgMessage);
  return new Error(`Failed query: select some_fn($1)\nparams: x`, { cause });
}

describe('mapDbError', () => {
  const cases: Array<[string, number, string]> = [
    ['delivery_override_date_mismatch', 409, 'override_date_mismatch'],
    ['delivery_override_student_mismatch', 409, 'override_student_mismatch'],
    ['delivery_override_not_temp', 409, 'override_not_temp'],
    ['delivery_override_locked', 409, 'otp_locked'],
    ['delivery_override_expired', 409, 'otp_expired'],
    ['delivery_override_not_active', 409, 'override_not_active'],
    ['delivery_override_not_found', 404, 'not_found'],
    ['admin_override_forbidden', 403, 'admin_override_forbidden'],
    ['delivery_otp_not_verified', 403, 'delivery_otp_not_verified'],
    ['identity_not_provisioned', 403, 'identity_not_provisioned'],
    ['students_still_on_trip', 409, 'students_still_on_trip'],
    ['vehicle_sweep_not_confirmed', 409, 'vehicle_sweep_not_confirmed'],
    ['trip_not_active', 409, 'trip_not_active'],
  ];

  for (const [pgMessage, status, code] of cases) {
    it(`${pgMessage} -> ${String(status)} ${code}`, () => {
      try {
        mapDbError(drizzleLike(pgMessage));
        expect.unreachable('hata atmalıydı');
      } catch (caught) {
        expect(caught).toBeInstanceOf(HttpError);
        const error = caught as HttpError;
        expect(error.statusCode).toBe(status);
        expect(error.code).toBe(code);
      }
    });
  }

  it('sebep zinciri iki kat derinse de bulur', () => {
    const root = new Error('students_still_on_trip');
    const middle = new Error('rollback', { cause: root });
    const top = new Error('Failed query: select complete_trip($1)', { cause: middle });
    try {
      mapDbError(top);
      expect.unreachable('hata atmalıydı');
    } catch (caught) {
      expect((caught as HttpError).code).toBe('students_still_on_trip');
    }
  });

  it('tanımadığı hatayı olduğu gibi yeniden atar', () => {
    const original = new Error('bilinmeyen');
    expect(() => {
      mapDbError(original);
    }).toThrow(original);
  });
});
