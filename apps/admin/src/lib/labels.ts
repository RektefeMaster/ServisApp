/**
 * Panelin Türkçe etiketleri.
 *
 * Ekranlar durum alanlarını ham haliyle basıyordu: operatör "sabah PREPARING ·
 * akşam READY", "sefer AUTO_CLOSED", "istisna PENDING_APPROVAL" görüyordu.
 * Bunlar veritabanı enum'ları; panelde çalışan kişinin diline çevrilmemişti ve
 * hangisinin müdahale gerektirdiği okunmuyordu.
 *
 * Sözlük, bilinmeyen bir değeri gizlemez — ham kodu döndürür. Yeni bir enum
 * üyesi eklendiğinde ekranda boşluk değil, çevrilmemiş kod görünür; bu da
 * eksiğin fark edilmesini sağlar.
 */

const TRIP_STATE: Record<string, string> = {
  PLANNED: 'Planlandı',
  READY: 'Hazır',
  ACTIVE: 'Yolda',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal edildi',
  SUSPENDED: 'Durduruldu',
  ABORTED: 'Yarıda kesildi',
  AUTO_CLOSED: 'Otomatik kapandı',
};

const STUDENT_STATE: Record<string, string> = {
  EXPECTED: 'Bekleniyor',
  ON_BOARD: 'Araçta',
  DELIVERED: 'Teslim edildi',
  ABSENT_PLANNED: 'Bugün binmeyecek',
  NO_SHOW: 'Durakta yoktu',
  MOVED_OUT: 'Başka sefere alındı',
  DELIVERY_FAILED: 'Teslim edilemedi',
  DELIVERED_LATE: 'Geç teslim edildi',
  RETURNED_TO_SCHOOL: 'Okula geri bırakıldı',
  HANDED_TO_ADMIN: 'Yöneticiye teslim edildi',
  RETURNED_HOME: 'Eve geri bırakıldı',
};

const PLAN_STATUS: Record<string, string> = {
  PREPARING: 'hazırlanıyor',
  READY: 'hazır',
  NO_SERVICE: 'servis yok',
  SUSPENDED: 'askıda',
};

const OVERRIDE_STATUS: Record<string, string> = {
  PENDING_APPROVAL: 'Onay bekliyor',
  ACTIVE: 'Kod gönderildi',
  VERIFIED: 'Doğrulandı',
  CANCELLED: 'İptal edildi',
  EXPIRED: 'Süresi doldu',
  LOCKED: 'Kilitli',
};

const REQUEST_STATUS: Record<string, string> = {
  PENDING: 'Onay bekliyor',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
};

const VERSION_STATUS: Record<string, string> = {
  DRAFT: 'Taslak',
  PUBLISHED: 'Yayında',
  ARCHIVED: 'Arşiv',
};

const MEMBERSHIP_STATUS: Record<string, string> = {
  ACTIVE: 'Aktif',
  INVITED: 'Davet edildi',
  SUSPENDED: 'Askıda',
  REVOKED: 'İptal edildi',
};

const RELATION_STATUS: Record<string, string> = {
  ACTIVE: 'aktif',
  REVOKED: 'iptal',
};

const IMPORT_ROW_STATUS: Record<string, string> = {
  PENDING: 'Bekliyor',
  READY: 'Hazır',
  NEEDS_FIX: 'Düzeltme gerekiyor',
  ADDRESS_UNVERIFIED: 'Adres doğrulanmadı',
  COMMITTED: 'Aktarıldı',
  FAILED: 'Başarısız',
};

const SEGMENT: Record<string, string> = {
  MORNING: 'Sabah',
  AFTERNOON: 'Akşam',
};

/**
 * Olay tipleri. Liste uzun ve açık uçludur (uygulama yeni tip yazabilir);
 * bilinmeyen tip okunur hale getirilir: `STUDENT_STATE` → `Student state`
 * yerine ham kod kalır, çünkü operatör ham kodu arama kutusuna yapıştırır.
 */
const EVENT_TYPE: Record<string, string> = {
  TRIP_GENERATED: 'Sefer planlandı',
  TRIP_REBUILT: 'Sefer planı yenilendi',
  TRIP_READY: 'Sefer hazır',
  TRIP_STARTED: 'Sefer başladı',
  TRIP_COMPLETED: 'Sefer tamamlandı',
  TRIP_CANCELLED: 'Sefer iptal edildi',
  VEHICLE_CHECK_BEFORE: 'Sefer öncesi araç kontrolü',
  VEHICLE_CHECK_AFTER: 'Sefer sonu araç kontrolü',
  STUDENT_STATE: 'Öğrenci durumu',
  STUDENT_STATE_CONFLICT: 'Öğrenci durumu çakıştı',
  STUDENT_STATE_UNDO: 'Öğrenci durumu geri alındı',
  CREW_INCIDENT: 'Personel notu',
  DELIVERY_OTP_VERIFIED: 'Teslim kodu doğrulandı',
  DELIVERY_ADMIN_OVERRIDE: 'Yönetici teslim onayı',
  TRIP_VEHICLE_CHANGED: 'Sefer aracı değişti',
  TRIP_CREW_CHANGED: 'Sefer personeli değişti',
  VEHICLE_ASSIGNED: 'Araç atandı',
  CREW_ASSIGNED: 'Personel atandı',
  PLAN_ABSENT: 'Devamsızlık planlandı',
  PLAN_TEMP_DELIVERY: 'Farklı teslimat planlandı',
  PLAN_MOVED_IN: 'Öğrenci sefere alındı',
  PLAN_MOVED_OUT: 'Öğrenci seferden çıkarıldı',
  PLAN_CHANGE_BLOCKED: 'Plan değişikliği engellendi',
};

const ACTOR_ROLE: Record<string, string> = {
  SYSTEM: 'Sistem',
  ADMIN: 'Yönetici',
  DRIVER: 'Şoför',
  ATTENDANT: 'Hostes',
  GUARDIAN: 'Veli',
};

function lookup(table: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—';
  return table[value] ?? value;
}

export const tripStateLabel = (value: string | null | undefined): string =>
  lookup(TRIP_STATE, value);
export const studentStateLabel = (value: string | null | undefined): string =>
  lookup(STUDENT_STATE, value);
export const actorRoleLabel = (value: string | null | undefined): string =>
  lookup(ACTOR_ROLE, value);
export const planStatusLabel = (value: string | null | undefined): string =>
  lookup(PLAN_STATUS, value);
export const overrideStatusLabel = (value: string | null | undefined): string =>
  lookup(OVERRIDE_STATUS, value);
export const requestStatusLabel = (value: string | null | undefined): string =>
  lookup(REQUEST_STATUS, value);
export const versionStatusLabel = (value: string | null | undefined): string =>
  lookup(VERSION_STATUS, value);
export const membershipStatusLabel = (value: string | null | undefined): string =>
  lookup(MEMBERSHIP_STATUS, value);
export const relationStatusLabel = (value: string | null | undefined): string =>
  lookup(RELATION_STATUS, value);
export const importRowStatusLabel = (value: string | null | undefined): string =>
  lookup(IMPORT_ROW_STATUS, value);
export const segmentLabel = (value: string | null | undefined): string => lookup(SEGMENT, value);
export const eventTypeLabel = (value: string | null | undefined): string =>
  lookup(EVENT_TYPE, value);

/** Tarihi operatörün okuduğu biçime çevirir; geçersizse ham metni korur. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}
