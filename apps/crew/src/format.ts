import { exhaustive } from '@servisapp/domain';
import type { StudentAction, StudentState, TripState } from '@servisapp/domain';

export function segmentLabel(segment: 'MORNING' | 'AFTERNOON'): string {
  return segment === 'MORNING' ? 'Sabah' : 'Akşam';
}

export function tripStateLabel(state: TripState): string {
  switch (state) {
    case 'PLANNED':
      return 'Planlandı';
    case 'READY':
      return 'Hazır';
    case 'ACTIVE':
      return 'Yolda';
    case 'COMPLETED':
      return 'Bitti';
    case 'CANCELLED':
      return 'İptal';
    case 'SUSPENDED':
      return 'Durdu';
    case 'ABORTED':
      return 'Kesildi';
    case 'AUTO_CLOSED':
      return 'Otomatik kapandı';
    default: {
      const unexpected: never = state;
      return exhaustive(unexpected, 'tripStateLabel');
    }
  }
}

export function studentStateLabel(state: StudentState): string {
  switch (state) {
    case 'EXPECTED':
      return 'Bekleniyor';
    case 'ON_BOARD':
      return 'Araçta';
    case 'DELIVERED':
      return 'Teslim';
    case 'ABSENT_PLANNED':
      return 'Binmeyecek';
    case 'NO_SHOW':
      return 'Binmedi';
    case 'MOVED_OUT':
      return 'Başka sefer';
    case 'DELIVERY_FAILED':
      return 'Teslim edilemedi';
    case 'DELIVERED_LATE':
      return 'Geç teslim';
    case 'RETURNED_TO_SCHOOL':
      return 'Okula döndü';
    case 'HANDED_TO_ADMIN':
      return 'Yöneticiye';
    case 'RETURNED_HOME':
      return 'Eve döndü';
    default: {
      const unexpected: never = state;
      return exhaustive(unexpected, 'studentStateLabel');
    }
  }
}

export function actionLabel(action: StudentAction): string {
  switch (action) {
    case 'BOARD':
      return 'Bindi';
    case 'MARK_NO_SHOW':
      return 'Binmedi';
    case 'DELIVER':
      return 'Teslim';
    case 'MARK_DELIVERY_FAILED':
      return 'Teslim edilemedi';
    case 'RETURN_HOME':
      return 'Eve dönüş';
    case 'RESOLVE_DELIVERED_LATE':
    case 'RESOLVE_RETURNED_TO_SCHOOL':
    case 'RESOLVE_HANDED_TO_ADMIN':
    case 'MARK_ABSENT_PLANNED':
    case 'MOVE_OUT':
      return action;
    default: {
      const unexpected: never = action;
      return exhaustive(unexpected, 'actionLabel');
    }
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('tr') ?? '');
  return letters.join('') || '?';
}

export function formatClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(at);
}
