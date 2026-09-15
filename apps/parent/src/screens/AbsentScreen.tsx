import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { ParentDayPlan } from '@servisapp/contracts';
import {
  AppText,
  SectionHeading,
  FlowHeader,
  ResultCard,
  AppIcon,
  Button,
  IconButton,
  InlineAlert,
  Screen,
  colors,
  radius,
  space,
  useHardwareBack,
} from '@servisapp/ui';
import {
  ApiError,
  cancelRideException,
  createRideException,
  fetchDayPlan,
  type ParentSession,
} from '../api/client';

function todayIstanbul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

export function AbsentScreen({
  session,
  studentId,
  studentName,
  onBack,
  onSessionInvalid,
}: {
  session: ParentSession;
  studentId: string;
  studentName: string;
  onBack: () => void;
  onSessionInvalid: () => void;
}) {
  const [plan, setPlan] = useState<ParentDayPlan | null>(null);
  const [morning, setMorning] = useState(false);
  const [evening, setEvening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  useHardwareBack(() => {
    if (!busy) onBack();
  });

  const reload = useCallback(async () => {
    try {
      const next = await fetchDayPlan(session, studentId);
      setPlan(next);
      setMorning(false);
      setEvening(false);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionInvalid();
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Plan okunamadı');
    }
  }, [onSessionInvalid, session, studentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit() {
    const segments: Array<'MORNING' | 'AFTERNOON'> = [];
    if (morning && !plan?.morningAbsent) segments.push('MORNING');
    if (evening && !plan?.eveningAbsent) segments.push('AFTERNOON');
    if (segments.length === 0) {
      setError('En az bir sefer seç');
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createRideException(session, {
        studentId,
        serviceDate: todayIstanbul(),
        segments,
      });
      setSaved(segments.map((segment) => (segment === 'MORNING' ? 'Sabah' : 'Akşam')).join(' ve '));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSessionInvalid();
      else
        setError(
          caught instanceof ApiError ? caught.message : 'Bildirim gönderilemedi. Yeniden dene.',
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function cancel(exceptionId: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await cancelRideException(session, exceptionId);
      setPlan((current) =>
        current
          ? {
              ...current,
              morningAbsent:
                current.morningExceptionId === exceptionId ? false : current.morningAbsent,
              morningExceptionId:
                current.morningExceptionId === exceptionId ? null : current.morningExceptionId,
              eveningAbsent:
                current.eveningExceptionId === exceptionId ? false : current.eveningAbsent,
              eveningExceptionId:
                current.eveningExceptionId === exceptionId ? null : current.eveningExceptionId,
            }
          : current,
      );
      setNotice('Bildirim geri alındı. Güncel servis planı uygulanacak.');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSessionInvalid();
      else setError(caught instanceof ApiError ? caught.message : 'İptal edilemedi');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (saved)
    return (
      <Screen scroll footer={<Button label="Çocuğun planına dön" onPress={onBack} />}>
        <FlowHeader
          title="Bildirim gönderildi"
          context={studentName}
          icon="calendar"
          description="Bugünün servis planı güncellendi."
        />
        <ResultCard
          title="Servis ekibine haber verildi"
          body={`${studentName} bugün ${saved.toLocaleLowerCase('tr-TR')} seferini kullanmayacak. Bildirimi çocuğun planından geri alabilirsin.`}
        />
      </Screen>
    );

  if (!plan) {
    return (
      <Screen>
        <IconButton label="← Çocuğun planı" disabled={busy} onPress={onBack} style={styles.back} />
        {error ? (
          <>
            <InlineAlert title={error} tone="danger" />
            <Button label="Tekrar dene" onPress={() => void reload()} variant="secondary" />
          </>
        ) : (
          <ActivityIndicator color={colors.rail} />
        )}
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      footer={
        <>
          <AppText preset="caption">Seçimin yalnızca bugün için geçerli.</AppText>
          <Button
            label="Servise haber ver"
            disabled={!morning && !evening}
            onPress={() => void submit()}
            loading={busy}
          />
        </>
      }
    >
      <IconButton label="← Çocuğun planı" disabled={busy} onPress={onBack} style={styles.back} />
      <FlowHeader
        title="Bugün kullanmayacak"
        context={studentName}
        icon="calendar"
        description="Kullanılmayacak seferi seç; servis ekibine hemen haber verelim."
      />
      {notice ? <InlineAlert title={notice} tone="ok" /> : null}
      {error ? <InlineAlert title={error} tone="danger" /> : null}

      <SectionHeading title="Hangi seferi kullanmayacak?" />
      <SegmentToggle
        label="Sabah"
        selected={morning || plan.morningAbsent}
        sent={plan.morningAbsent}
        disabled={busy || plan.morningAbsent}
        onPress={() => setMorning((value) => !value)}
      />
      <SegmentToggle
        label="Akşam"
        selected={evening || plan.eveningAbsent}
        sent={plan.eveningAbsent}
        disabled={busy || plan.eveningAbsent}
        onPress={() => setEvening((value) => !value)}
      />

      {plan.morningExceptionId ? (
        <Button
          label="Sabah bildirimini geri al"
          variant="ghost"
          disabled={busy}
          onPress={() => void cancel(plan.morningExceptionId ?? '')}
          style={styles.undo}
        />
      ) : null}
      {plan.eveningExceptionId ? (
        <Button
          label="Akşam bildirimini geri al"
          variant="ghost"
          disabled={busy}
          onPress={() => void cancel(plan.eveningExceptionId ?? '')}
          style={styles.undo}
        />
      ) : null}
    </Screen>
  );
}

function SegmentToggle({
  label,
  selected,
  sent,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  sent?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.row, selected ? styles.rowSelected : null]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: Boolean(disabled) }}
    >
      <AppIcon name={label === 'Sabah' ? 'sun' : 'home'} />
      <View style={{ flex: 1, gap: 4 }}>
        <AppText preset="section">{label}</AppText>
        <AppText preset="meta">
          {sent
            ? 'Servise bildirildi · aşağıdan geri alabilirsin'
            : label === 'Sabah'
              ? 'Okula gidiş'
              : 'Eve dönüş'}
        </AppText>
      </View>
      <View style={[styles.check, selected && styles.checkSelected]}>
        <AppText color={colors.paper}>{selected ? '✓' : ''}</AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    marginBottom: space.xs,
    paddingHorizontal: 0,
  },
  lede: {
    marginTop: space.xxs,
    marginBottom: space.lg,
  },
  row: {
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    marginBottom: space.sm,
    minHeight: 100,
    gap: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  checkSelected: { backgroundColor: colors.rail, borderColor: colors.rail },
  rowSelected: {
    borderColor: colors.rail,
    backgroundColor: colors.railSoft,
  },
  undo: {
    alignSelf: 'flex-start',
    paddingHorizontal: 0,
  },
  submit: {
    marginTop: space.lg,
  },
});
