import { exhaustive } from '@servisapp/domain';
import type {
  OverrideStatus,
  ParentHomeChild,
  StudentPlanStatus,
  StudentState,
} from '@servisapp/contracts';

export type StatusTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'rail';

export type DerivedChildStatus = {
  statusLabel: string;
  statusTone: StatusTone;
  contextLine: string | null;
  warningLine: string | null;
  showLive: boolean;
};

function segmentLabel(segment: 'MORNING' | 'AFTERNOON'): string {
  return segment === 'MORNING' ? 'Sabah' : 'Akşam';
}

function currentSegment(): 'MORNING' | 'AFTERNOON' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Istanbul',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  );
  return hour < 12 ? 'MORNING' : 'AFTERNOON';
}

function studentStateLabel(state: StudentState): string {
  switch (state) {
    case 'EXPECTED':
      return 'Araç geliyor';
    case 'ON_BOARD':
      return 'Araçta';
    case 'DELIVERED':
      return 'Teslim edildi';
    case 'ABSENT_PLANNED':
      return 'Binmeyecek';
    case 'NO_SHOW':
      return 'Binmedi';
    case 'MOVED_OUT':
      return 'Başka sefere alındı';
    case 'DELIVERY_FAILED':
      return 'Teslim edilemedi';
    case 'DELIVERED_LATE':
      return 'Geç teslim';
    case 'RETURNED_TO_SCHOOL':
      return 'Okula döndü';
    case 'HANDED_TO_ADMIN':
      return 'Yöneticiye verildi';
    case 'RETURNED_HOME':
      return 'Eve döndü';
    default: {
      const unexpected: never = state;
      return exhaustive(unexpected, 'studentStateLabel');
    }
  }
}

export function deliveryOverrideLabel(status: OverrideStatus): string {
  switch (status) {
    case 'PENDING_APPROVAL':
      return 'Farklı teslimat onay bekliyor';
    case 'ACTIVE':
      return 'Farklı teslimat aktif';
    case 'VERIFIED':
      return 'Farklı teslimat doğrulandı';
    case 'CANCELLED':
      return 'Farklı teslimat iptal';
    case 'EXPIRED':
      return 'Farklı teslimat süresi doldu';
    case 'LOCKED':
      return 'Farklı teslimat kilitli';
    default: {
      const unexpected: never = status;
      return exhaustive(unexpected, 'deliveryOverrideLabel');
    }
  }
}

/** Çocuk ekranının segment rozeti: plan durumu + bugünkü yokluk. */
export function segmentChip(
  status: StudentPlanStatus,
  absent: boolean,
): { label: string; tone: 'neutral' | 'warn' } {
  if (absent) return { label: 'Binmeyecek', tone: 'warn' };
  switch (status) {
    case 'READY':
      return { label: 'Planlı', tone: 'neutral' };
    case 'PREPARING':
      return { label: 'Hazırlanıyor', tone: 'neutral' };
    case 'NO_SERVICE':
      return { label: 'Servis yok', tone: 'neutral' };
    case 'SUSPENDED':
      return { label: 'Askıda', tone: 'warn' };
    default:
      return exhaustive(status, 'segmentChip');
  }
}

function planStatusLabel(
  status: ParentHomeChild['morningPlanStatus'],
  segment: 'MORNING' | 'AFTERNOON',
): { statusLabel: string; statusTone: StatusTone; contextLine: string | null } {
  const when = segmentLabel(segment);
  switch (status) {
    case 'PREPARING':
      return {
        statusLabel: 'Servis hazırlanıyor',
        statusTone: 'neutral',
        contextLine: `${when} · henüz başlamadı`,
      };
    case 'READY':
      return {
        statusLabel: 'Servis planlı',
        statusTone: 'neutral',
        contextLine: `${when} · bugün servis var`,
      };
    case 'NO_SERVICE':
      return {
        statusLabel: 'Bu sefer yok',
        statusTone: 'neutral',
        contextLine: `${when} servisi tanımlı değil`,
      };
    case 'SUSPENDED':
      return {
        statusLabel: 'Servis askıda',
        statusTone: 'warn',
        contextLine: `${when} · şirket bilgilendirmesini bekle`,
      };
    default: {
      const unexpected: never = status;
      return exhaustive(unexpected, 'planStatusLabel');
    }
  }
}

/** Kapanmış seferde gösterilmeye değer sonuç; değilse plan görünümü kalır. */
function finishedOutcome(state: StudentState): { tone: StatusTone; context: string } | null {
  switch (state) {
    case 'DELIVERED':
    case 'DELIVERED_LATE':
      return { tone: 'ok', context: 'tamamlandı' };
    case 'RETURNED_HOME':
    case 'RETURNED_TO_SCHOOL':
    case 'HANDED_TO_ADMIN':
      return { tone: 'warn', context: 'tamamlandı' };
    case 'NO_SHOW':
      return { tone: 'warn', context: 'durakta bulunamadı' };
    case 'DELIVERY_FAILED':
      return { tone: 'danger', context: 'teslim edilemedi' };
    case 'EXPECTED':
    case 'ON_BOARD':
    case 'ABSENT_PLANNED':
    case 'MOVED_OUT':
      return null;
    default:
      return exhaustive(state, 'finishedOutcome');
  }
}

function liveActive(child: ParentHomeChild): boolean {
  const live = child.live;
  if (!live || live.trackingEnded) return false;
  // Stale / liveAvailable=false → dikkat kademesi (canlı hero değil).
  if (!live.liveAvailable || live.staleMessage) return false;
  return true;
}

function needsAttention(child: ParentHomeChild): boolean {
  const day = child.day;
  if (day?.morningAbsent || day?.eveningAbsent) return true;
  const override = day?.deliveryOverride;
  if (override && (override.status === 'PENDING_APPROVAL' || override.status === 'ACTIVE')) {
    return true;
  }
  const live = child.live;
  if (live && !live.trackingEnded && (live.staleMessage || !live.liveAvailable)) return true;
  return false;
}

/** Parent Home Status Surface — yalnız mevcut contract alanlarından. */
export function deriveChildStatus(child: ParentHomeChild): DerivedChildStatus {
  const live = child.live;
  const day = child.day;
  const override = day?.deliveryOverride ?? null;

  if (live && !live.trackingEnded) {
    let statusLabel = studentStateLabel(live.studentState);
    let statusTone: StatusTone = 'rail';

    if (live.studentState === 'EXPECTED' && live.approaching) {
      statusLabel = 'Yaklaşıyor';
      statusTone = 'rail';
    } else if (live.studentState === 'DELIVERY_FAILED') {
      statusTone = 'danger';
    } else if (live.studentState === 'ON_BOARD') {
      statusTone = 'rail';
    }

    const contextParts: string[] = [segmentLabel(live.segment)];
    if (live.etaText) contextParts.push(live.etaText);
    else if (live.studentState === 'EXPECTED') contextParts.push('Konum alınıyor');

    const warningParts: string[] = [];
    if (live.staleMessage) warningParts.push(live.staleMessage);
    if (override && (override.status === 'PENDING_APPROVAL' || override.status === 'ACTIVE')) {
      warningParts.push(deliveryOverrideLabel(override.status));
    }
    if (day?.morningAbsent || day?.eveningAbsent) {
      const bits: string[] = [];
      if (day.morningAbsent) bits.push('sabah yok');
      if (day.eveningAbsent) bits.push('akşam yok');
      warningParts.push(`Bugün: ${bits.join(', ')}`);
    }

    return {
      statusLabel,
      statusTone,
      contextLine: contextParts.join(' · '),
      warningLine: warningParts.length > 0 ? warningParts.join(' · ') : null,
      showLive: true,
    };
  }

  /**
   * Sefer bitti ama BUGÜNÜN sonucu hâlâ velinin sorusunun cevabı.
   *
   * Burada eskiden doğrudan plan görünümüne düşülüyordu: çocuk akşam 17:40'ta
   * teslim edilmiş olsa bile kart gece boyunca "Servis planlı · bugün servis
   * var" yazıyordu. Uydurma yok — gösterilen şey sunucunun bildirdiği son
   * öğrenci durumu ve yalnız İÇİNDE BULUNULAN segment için.
   */
  const segment = currentSegment();
  if (live?.trackingEnded && live.segment === segment) {
    const outcome = finishedOutcome(live.studentState);
    if (outcome) {
      return {
        statusLabel: studentStateLabel(live.studentState),
        statusTone: outcome.tone,
        contextLine: `${segmentLabel(segment)} · ${outcome.context}`,
        warningLine:
          override && (override.status === 'PENDING_APPROVAL' || override.status === 'ACTIVE')
            ? deliveryOverrideLabel(override.status)
            : null,
        showLive: false,
      };
    }
  }
  const absentNow =
    segment === 'MORNING' ? Boolean(day?.morningAbsent) : Boolean(day?.eveningAbsent);
  const absentOther =
    segment === 'MORNING' ? Boolean(day?.eveningAbsent) : Boolean(day?.morningAbsent);

  if (absentNow) {
    return {
      statusLabel: 'Bugün binmeyecek',
      statusTone: 'warn',
      contextLine: `${segmentLabel(segment)} için yokluk bildirildi`,
      warningLine: override ? deliveryOverrideLabel(override.status) : null,
      showLive: false,
    };
  }

  if (override && (override.status === 'PENDING_APPROVAL' || override.status === 'ACTIVE')) {
    const plan = planStatusLabel(
      segment === 'MORNING' ? child.morningPlanStatus : child.eveningPlanStatus,
      segment,
    );
    return {
      statusLabel: deliveryOverrideLabel(override.status),
      statusTone: override.status === 'PENDING_APPROVAL' ? 'warn' : 'rail',
      contextLine: override.addressText,
      warningLine: override.otpSentTo
        ? `Kod ${override.otpSentTo} numarasına gitti`
        : absentOther
          ? segment === 'MORNING'
            ? 'Akşam için de yokluk var'
            : 'Sabah için de yokluk var'
          : plan.contextLine,
      showLive: false,
    };
  }

  const plan = planStatusLabel(
    segment === 'MORNING' ? child.morningPlanStatus : child.eveningPlanStatus,
    segment,
  );

  const warningBits: string[] = [];
  if (absentOther) {
    warningBits.push(
      segment === 'MORNING' ? 'Akşam için yokluk bildirildi' : 'Sabah için yokluk bildirildi',
    );
  }
  if (override) warningBits.push(deliveryOverrideLabel(override.status));

  return {
    statusLabel: plan.statusLabel,
    statusTone: plan.statusTone,
    contextLine: child.schoolName ? `${child.schoolName} · ${plan.contextLine}` : plan.contextLine,
    warningLine: warningBits.length > 0 ? warningBits.join(' · ') : null,
    showLive: false,
  };
}

/** Canlı → dikkat (yokluk/stale/teslimat) → idle. */
export function sortHomeChildren(children: ParentHomeChild[]): ParentHomeChild[] {
  return [...children].sort((left, right) => {
    const rank = (child: ParentHomeChild): number => {
      if (liveActive(child)) return 0;
      if (needsAttention(child)) return 1;
      return 2;
    };
    const diff = rank(left) - rank(right);
    if (diff !== 0) return diff;
    return left.fullName.localeCompare(right.fullName, 'tr');
  });
}

/** Harita bağlantısı veya "enlem,boylam" yapıştırmasından koordinat. */
export function parseLocationInput(raw: string): { lat: number; lng: number } | null {
  const text = raw.trim();
  if (!text) return null;

  const valid = (lat: number, lng: number): boolean =>
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;

  const fromMatch = (match: RegExpMatchArray | null): { lat: number; lng: number } | null => {
    const a = match?.[1];
    const b = match?.[2];
    if (a === undefined || b === undefined) return null;
    const lat = Number(a);
    const lng = Number(b);
    return valid(lat, lng) ? { lat, lng } : null;
  };

  // Kısa goo.gl / maps.app.goo.gl linkleri sunucu yönlendirmesi olmadan çözülemez.
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(text)) {
    return null;
  }

  return (
    fromMatch(text.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/)) ??
    fromMatch(text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)) ??
    fromMatch(text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)) ??
    fromMatch(text.match(/geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i)) ??
    fromMatch(text.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i)) ??
    fromMatch(text.match(/[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?)%2C(-?\d+(?:\.\d+)?)/i)) ??
    fromMatch(text.match(/[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i)) ??
    fromMatch(text.match(/\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\/|$|\?)/))
  );
}

/** Live ekranı — uydurma durak sayısı yok; yalnız yaklaşma / ETA sinyalleri. */
export function liveProgressSteps(view: {
  approaching: boolean;
  etaText: string | null;
  liveAvailable: boolean;
  trackingEnded: boolean;
}): Array<{ id: string; label: string; active?: boolean; done?: boolean }> {
  if (view.trackingEnded) {
    return [{ id: 'ended', label: 'Takip kapandı', done: true }];
  }

  const steps: Array<{ id: string; label: string; active?: boolean; done?: boolean }> = [];

  if (view.approaching) {
    steps.push({ id: 'approach', label: 'Duraka yaklaşıyor', active: true });
  } else if (view.etaText) {
    steps.push({ id: 'eta', label: view.etaText, active: true });
    steps.push({ id: 'approach', label: 'Duraka yaklaşma', done: false });
  } else {
    steps.push({
      id: 'wait',
      label: view.liveAvailable ? 'Konum alınıyor' : 'Canlı konum bekleniyor',
      active: true,
    });
  }

  return steps;
}
