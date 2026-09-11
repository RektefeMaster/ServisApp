import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ParentDayPlan } from '@servisapp/contracts';
import { colors, space } from '@servisapp/ui';
import { ApiError, fetchDayPlan, resendDeliveryOtp, type ParentSession } from '../api/client';

export function ChildScreen({
  session,
  studentId,
  studentName,
  onBack,
  onAbsent,
  onDelivery,
  onAddress,
  onSessionInvalid,
}: {
  session: ParentSession;
  studentId: string;
  studentName: string;
  onBack: () => void;
  onAbsent: () => void;
  onDelivery: () => void;
  onAddress: () => void;
  onSessionInvalid: () => void;
}) {
  const [plan, setPlan] = useState<ParentDayPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPlan(await fetchDayPlan(session, studentId));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionInvalid();
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Gün planı yüklenemedi');
    }
  }, [onSessionInvalid, session, studentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function resend() {
    const overrideId = plan?.deliveryOverride?.id;
    if (!overrideId) return;
    setBusy(true);
    try {
      const next = await resendDeliveryOtp(session, overrideId);
      setPlan((current) =>
        current?.deliveryOverride
          ? {
              ...current,
              deliveryOverride: { ...current.deliveryOverride, otpCode: next.otpCode },
            }
          : current,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Kod gönderilemedi');
    } finally {
      setBusy(false);
    }
  }

  const override = plan?.deliveryOverride;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← Ana ekran</Text>
      </Pressable>
      <Text style={styles.name}>{studentName}</Text>
      <Text style={styles.lede}>Bugünkü plan yalnız senin çocuğun için.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!plan ? <ActivityIndicator color={colors.headlamp} /> : null}
      {plan ? (
        <View style={styles.card}>
          <Text style={styles.meta}>
            Sabah: {plan.morningAbsent ? 'binmeyecek' : 'planlı'}
          </Text>
          <Text style={styles.meta}>
            Akşam: {plan.eveningAbsent ? 'binmeyecek' : 'planlı'}
          </Text>
          {override ? (
            <>
              <Text style={styles.meta}>
                Farklı teslimat · {override.status === 'PENDING_APPROVAL' ? 'yönetici onayı bekleniyor' : override.status}
              </Text>
              <Text style={styles.meta}>{override.addressText}</Text>
              {override.otpCode ? <Text style={styles.code}>{override.otpCode}</Text> : null}
              {override.status === 'ACTIVE' ? (
                <Pressable disabled={busy} onPress={() => void resend()} style={styles.secondary}>
                  <Text style={styles.secondaryText}>Kodu yeniden göster</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Text style={styles.meta}>Bugün ev adresine bırakılacak</Text>
          )}
        </View>
      ) : null}
      <Pressable onPress={onAbsent} style={styles.cta}>
        <Text style={styles.ctaText}>Bugün kullanmayacak</Text>
      </Pressable>
      <Pressable onPress={onDelivery} style={styles.cta}>
        <Text style={styles.ctaText}>Farklı teslimat</Text>
      </Pressable>
      <Pressable onPress={onAddress} style={styles.cta}>
        <Text style={styles.ctaText}>Adres değişikliği</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.asphalt },
  content: { padding: space.lg, paddingTop: 56 },
  back: { color: colors.headlamp, marginBottom: space.md },
  name: { color: colors.paper, fontSize: 28, fontWeight: '800' },
  lede: { color: colors.muted, marginTop: 6, marginBottom: space.lg },
  error: { color: colors.danger, marginBottom: space.md },
  card: { backgroundColor: colors.steel, borderRadius: 20, padding: space.lg, marginBottom: space.md },
  meta: { color: colors.muted, marginTop: 6 },
  code: { color: colors.headlamp, fontSize: 32, fontWeight: '800', marginTop: space.md, letterSpacing: 6 },
  cta: {
    backgroundColor: colors.headlamp,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  ctaText: { color: colors.asphalt, fontWeight: '800' },
  secondary: { marginTop: space.md, alignItems: 'center' },
  secondaryText: { color: colors.headlamp, fontWeight: '700' },
});
