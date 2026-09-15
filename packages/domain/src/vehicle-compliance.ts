/**
 * Araç evrakı: muayene ve sigorta.
 *
 * Bu tarihler şemada baştan beri tutuluyordu ama hiçbir davranış üretmiyordu:
 * sigortası 1 Ağustos'ta biten minibüs 12 Eylül'de sefere çıkabiliyordu. Kayıt
 * tutup kural işletmemek, en kötüsü — "biliyorduk ve bıraktık" demektir.
 *
 * Kırmızı çizgi seferin BAŞLAMASIDIR: evrakı geçmiş araçla çocuk taşınmaz.
 * Kaçış kapısı "zorla başlat" değil, aracı değiştirmektir; bu yüzden burada
 * override yok. Uyarı eşiği sayesinde yönetici günler öncesinden görür.
 */
export const VEHICLE_DOCUMENT_WARNING_DAYS = 15;

export type VehicleComplianceBlock = 'INSPECTION_EXPIRED' | 'INSURANCE_EXPIRED';
export type VehicleComplianceWarning = 'INSPECTION_SOON' | 'INSURANCE_SOON';

export interface VehicleDocuments {
  inspectionExpiry: string | null;
  insuranceExpiry: string | null;
}

function ymd(value: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/** Servis gününde geçerli olmayan evrak varsa engel döner; eksik kayıt engel değildir. */
export function vehicleComplianceBlock(
  documents: VehicleDocuments,
  serviceDate: string,
): VehicleComplianceBlock | null {
  const inspection = ymd(documents.inspectionExpiry);
  const insurance = ymd(documents.insuranceExpiry);
  if (inspection && inspection < serviceDate) return 'INSPECTION_EXPIRED';
  if (insurance && insurance < serviceDate) return 'INSURANCE_EXPIRED';
  return null;
}

/** Yaklaşan bitişler; yönetici paneli günler öncesinden görsün diye. */
export function vehicleComplianceWarnings(
  documents: VehicleDocuments,
  serviceDate: string,
  withinDays = VEHICLE_DOCUMENT_WARNING_DAYS,
): VehicleComplianceWarning[] {
  const limit = addDays(serviceDate, withinDays);
  const out: VehicleComplianceWarning[] = [];
  const inspection = ymd(documents.inspectionExpiry);
  const insurance = ymd(documents.insuranceExpiry);
  if (inspection && inspection >= serviceDate && inspection <= limit) out.push('INSPECTION_SOON');
  if (insurance && insurance >= serviceDate && insurance <= limit) out.push('INSURANCE_SOON');
  return out;
}

export function vehicleComplianceMessage(
  reason: VehicleComplianceBlock | VehicleComplianceWarning,
  plate: string,
): string {
  switch (reason) {
    case 'INSPECTION_EXPIRED':
      return `${plate}: muayene süresi geçmiş; bu araçla sefer başlatılamaz`;
    case 'INSURANCE_EXPIRED':
      return `${plate}: sigorta süresi geçmiş; bu araçla sefer başlatılamaz`;
    case 'INSPECTION_SOON':
      return `${plate}: muayene süresi yaklaşıyor`;
    case 'INSURANCE_SOON':
      return `${plate}: sigorta süresi yaklaşıyor`;
  }
}

function addDays(serviceDate: string, days: number): string {
  const at = new Date(`${serviceDate}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return serviceDate;
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
