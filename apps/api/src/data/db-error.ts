import { badRequest, conflict, HttpError, notFound } from '../http-error.js';

export function mapDbError(error: unknown): never {
  if (error instanceof HttpError) throw error;

  const message = errorMessage(error);
  if (message.includes('identity_not_provisioned')) {
    throw new HttpError(403, 'identity_not_provisioned', 'Bu hesap henüz tanımlanmamış');
  }
  if (message.includes('delivery_otp_not_verified')) {
    throw new HttpError(403, 'delivery_otp_not_verified', 'OTP doğrulanmadan teslim işaretlenemez');
  }
  if (message.includes('admin_override_forbidden')) {
    throw new HttpError(403, 'admin_override_forbidden', 'Teslim iptali yalnız yöneticidedir');
  }
  if (message.includes('delivery_override_not_found')) {
    throw notFound('Teslim talebi bulunamadı');
  }
  if (message.includes('delivery_override_not_active')) {
    throw conflict('override_not_active', 'Teslim talebi bu durumda onaylanamaz');
  }
  if (message.includes('delivery_override_expired')) {
    throw conflict('otp_expired', 'Kodun süresi doldu');
  }
  if (message.includes('delivery_override_locked')) {
    throw conflict('otp_locked', 'Kod kilitli; yönetici onayı gerekir');
  }
  if (message.includes('delivery_override_student_mismatch')) {
    throw conflict('override_student_mismatch', 'Teslim talebi bu öğrenciye ait değil');
  }
  if (message.includes('delivery_override_not_temp')) {
    throw conflict('override_not_temp', 'Bu öğrenci farklı teslimatta değil');
  }
  if (message.includes('admin_override_reason_required')) {
    throw badRequest('invalid_body', 'Yönetici onay gerekçesi zorunlu');
  }
  if (message.includes('identity_auth_mismatch')) {
    throw conflict('identity_auth_mismatch', 'Kimlik başka bir hesaba bağlı');
  }
  if (message.includes('identity_email_conflict')) {
    throw conflict('identity_email_conflict', 'Bu e-posta başka bir kimliğe kayıtlı');
  }
  if (message.includes('identity_conflict')) {
    throw conflict('identity_conflict', 'Bu kimlik zaten kayıtlı');
  }
  if (message.includes('identity_phone_invalid')) {
    throw badRequest('identity_phone_invalid', 'Telefon E.164 biçiminde olmalı');
  }
  if (message.includes('identity_name_required')) {
    throw badRequest('identity_name_required', 'Ad soyad zorunlu');
  }

  const code = pgCode(error);
  const constraint = pgConstraint(error);
  if (code === '23505') {
    if (constraint === 'route_version_one_draft' || message.includes('route_version_one_draft')) {
      throw conflict('draft_exists', 'Bu rotada zaten bir taslak var');
    }
    if (
      constraint === 'route_version_one_published' ||
      message.includes('route_version_one_published')
    ) {
      throw conflict('already_published', 'Bu rotada zaten yayınlı bir sürüm var');
    }
    if (constraint === 'route_stop_stop' || message.includes('route_stop_stop')) {
      throw badRequest('duplicate_stop', 'Aynı durak rotada iki kez olamaz');
    }
    if (
      constraint === 'guardian_invite_one_pending' ||
      message.includes('guardian_invite_one_pending')
    ) {
      throw conflict('invite_pending', 'Bu üyelikte zaten bekleyen bir davet var');
    }
    throw conflict('duplicate', 'Bu kayıt zaten var');
  }
  if (code === '23503') {
    throw badRequest('invalid_reference', 'Bağlı kayıt bulunamadı');
  }
  if (code === '23514') {
    throw badRequest('check_violation', 'Kayıt kurala uymuyor');
  }
  if (message.includes('students_still_on_trip')) {
    throw conflict('students_still_on_trip', 'Araçta öğrenci varken sefer kapanamaz');
  }
  if (message.includes('vehicle_sweep_not_confirmed')) {
    throw conflict('vehicle_sweep_not_confirmed', 'Sefer sonu araç boş kontrolü yok');
  }
  if (message.includes('trip_not_active')) {
    throw conflict('trip_not_active', 'Sefer aktif değil');
  }
  if (message.includes('trip_not_found') || message.includes('trip_student_not_found')) {
    throw notFound();
  }
  if (message.includes('trip_stop_not_on_trip')) {
    throw badRequest('invalid_reference', 'Durak bu sefere ait değil');
  }
  throw error instanceof Error ? error : new Error(String(error));
}

export function isUniqueViolation(error: unknown, fragment: string): boolean {
  if (pgCode(error) !== '23505') return false;
  const constraint = pgConstraint(error) ?? '';
  return constraint.includes(fragment) || errorMessage(error).includes(fragment);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current && typeof current === 'object'; i += 1) {
    if ('code' in current && typeof current.code === 'string' && /^\d{5}$/.test(current.code)) {
      return current.code;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function pgConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current && typeof current === 'object'; i += 1) {
    const record = current as { constraint?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof record.constraint_name === 'string' && record.constraint_name.length > 0) {
      return record.constraint_name;
    }
    if (typeof record.constraint === 'string' && record.constraint.length > 0) {
      return record.constraint;
    }
    current = record.cause;
  }
  return undefined;
}
