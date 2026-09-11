export function composeNotification(input: {
  type: string;
  studentName: string;
}): { title: string; body: string } {
  const name = input.studentName.trim() || 'Çocuğun';
  switch (input.type) {
    case 'STUDENT_ON_BOARD':
      return { title: 'Servise bindi', body: `${name} servise bindi.` };
    case 'STUDENT_NO_SHOW':
      return { title: 'Durakta yok', body: `${name} durakta bulunamadı.` };
    case 'STUDENT_DELIVERED':
      return { title: 'Teslim edildi', body: `${name} teslim edildi.` };
    case 'STUDENT_DELIVERY_FAILED':
      return { title: 'Teslim edilemedi', body: `${name} teslim edilemedi.` };
    case 'STUDENT_RETURNED_HOME':
      return { title: 'Eve döndü', body: `${name} eve bırakıldı.` };
    case 'STUDENT_DELIVERED_LATE':
      return { title: 'Geç teslim', body: `${name} geç teslim edildi.` };
    case 'STUDENT_RETURNED_TO_SCHOOL':
      return { title: 'Okula döndü', body: `${name} okula geri bırakıldı.` };
    case 'STUDENT_HANDED_TO_ADMIN':
      return { title: 'Yöneticiye teslim', body: `${name} yöneticiye teslim edildi.` };
    case 'STUDENT_ABSENT_PLANNED':
      return { title: 'Binmeyecek', body: `${name} bugün servise binmeyecek.` };
    case 'STUDENT_MOVED_OUT':
      return { title: 'Sefer değişti', body: `${name} başka sefere alındı.` };
    case 'STUDENT_EXPECTED':
      return { title: 'Durum güncellendi', body: `${name} yeniden bekleniyor.` };
    case 'STUDENT_STATE_CORRECTED':
      return { title: 'Düzeltme', body: `${name} için önceki durum bildirimi düzeltildi.` };
    case 'APPROACH':
      return { title: 'Servis yaklaşıyor', body: `${name} için servis yaklaşıyor.` };
    case 'DELIVERY_OVERRIDE':
      return {
        title: 'Farklı teslimat',
        body: `${name} için farklı teslimat talebi oluşturuldu.`,
      };
    case 'DELIVERY_OTP':
      return { title: 'Teslim kodu', body: `${name} için teslim kodu gönderildi.` };
    case 'RIDE_EXCEPTION':
      return { title: 'Bugün binmeyecek', body: `${name} bugün servise binmeyecek.` };
    default:
      return { title: 'ServisApp', body: `${name} için bir güncelleme var.` };
  }
}

export function netgsmGsmNo(e164: string): string {
  return e164.replace(/^\+/, '');
}
