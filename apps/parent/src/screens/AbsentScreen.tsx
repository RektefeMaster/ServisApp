import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ParentDayPlan } from '@servisapp/contracts';
import { colors, space } from '@servisapp/ui';
import { ApiError, cancelRideException, createRideException, fetchDayPlan, type ParentSession } from '../api/client';

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
  const [morning, setMorning] = useState(true);
  const [evening, setEvening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await fetchDayPlan(session, studentId);
      setPlan(next);
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
    if (morning) segments.push('MORNING');
    if (evening) segments.push('AFTERNOON');
    if (segments.length === 0) {
      setError('En az bir sefer seç');
      return;
    }
    setBusy(true);
    try {
      await createRideException(session, {
        studentId,
        serviceDate: todayIstanbul(),
        segments,
      });
      await reload();
      onBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'İstisna kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(exceptionId: string) {
    setBusy(true);
    try {
      await cancelRideException(session, exceptionId);
      await reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'İptal edilemedi');
    } finally {
      setBusy(false);
    }
  }

  if (!plan) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={colors.headlamp} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← Çocuk</Text>
      </Pressable>
      <Text style={styles.title}>Bugün kullanmayacak</Text>
      <Text style={styles.lede}>{studentName} için yalnız bugün. Araçtaysa teslim akışına gider.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={() => setMorning((value) => !value)} style={styles.row}>
        <Text style={styles.rowText}>Sabah {morning ? '• seçili' : ''}</Text>
      </Pressable>
      <Pressable onPress={() => setEvening((value) => !value)} style={styles.row}>
        <Text style={styles.rowText}>Akşam {evening ? '• seçili' : ''}</Text>
      </Pressable>
      {plan.morningExceptionId ? (
        <Pressable
          disabled={busy}
          onPress={() => void cancel(plan.morningExceptionId ?? '')}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Sabah istisnasını geri al</Text>
        </Pressable>
      ) : null}
      {plan.eveningExceptionId ? (
        <Pressable
          disabled={busy}
          onPress={() => void cancel(plan.eveningExceptionId ?? '')}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Akşam istisnasını geri al</Text>
        </Pressable>
      ) : null}
      <Pressable disabled={busy} onPress={() => void submit()} style={styles.cta}>
        <Text style={styles.ctaText}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.asphalt, padding: space.lg, paddingTop: 56 },
  back: { color: colors.headlamp, marginBottom: space.md },
  title: { color: colors.paper, fontSize: 28, fontWeight: '800' },
  lede: { color: colors.muted, marginTop: 6, marginBottom: space.lg },
  error: { color: colors.danger, marginBottom: space.md },
  row: { backgroundColor: colors.steel, borderRadius: 12, padding: space.md, marginBottom: space.sm },
  rowText: { color: colors.paper, fontWeight: '700' },
  cta: {
    backgroundColor: colors.headlamp,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
  },
  ctaText: { color: colors.asphalt, fontWeight: '800' },
  secondary: { marginTop: space.sm, alignItems: 'center', padding: space.md },
  secondaryText: { color: colors.headlamp, fontWeight: '700' },
});
