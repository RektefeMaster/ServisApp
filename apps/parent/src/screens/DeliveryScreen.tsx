import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ParentDayPlan } from '@servisapp/contracts';
import { colors, space } from '@servisapp/ui';
import {
  ApiError,
  cancelDeliveryOverride,
  createAddressChange,
  createDeliveryOverride,
  fetchDayPlan,
  type ParentSession,
} from '../api/client';

function todayIstanbul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

export function DeliveryScreen({
  session,
  studentId,
  studentName,
  mode,
  onBack,
  onSessionInvalid,
}: {
  session: ParentSession;
  studentId: string;
  studentName: string;
  mode: 'delivery' | 'address';
  onBack: () => void;
  onSessionInvalid: () => void;
}) {
  const [plan, setPlan] = useState<ParentDayPlan | null>(null);
  const [addressText, setAddressText] = useState('Erenköy Mah. geçici teslim');
  const [lat, setLat] = useState('40.9720');
  const [lng, setLng] = useState('29.0760');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('+90');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setPlan(await fetchDayPlan(session, studentId));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSessionInvalid();
    }
  }, [onSessionInvalid, session, studentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit() {
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    setBusy(true);
    setError(null);
    try {
      if (mode === 'delivery') {
        await createDeliveryOverride(session, {
          studentId,
          serviceDate: todayIstanbul(),
          lat: parsedLat,
          lng: parsedLng,
          addressText,
          receiverName,
          receiverPhone,
        });
      } else {
        await createAddressChange(session, {
          studentId,
          lat: parsedLat,
          lng: parsedLng,
          addressText,
          effectiveFromDate: todayIstanbul(),
        });
      }
      onBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Kayıt başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function cancelOverride() {
    const overrideId = plan?.deliveryOverride?.id;
    if (!overrideId) return;
    setBusy(true);
    try {
      await cancelDeliveryOverride(session, overrideId);
      await reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'İptal edilemedi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← Çocuk</Text>
      </Pressable>
      <Text style={styles.title}>{mode === 'delivery' ? 'Farklı teslimat' : 'Adres değişikliği'}</Text>
      <Text style={styles.lede}>
        {mode === 'delivery'
          ? `${studentName} için bugün. Kod personele gitmez; yalnız sende görünür.`
          : `${studentName} için kalıcı adres talebi. Onaylı sefer anlığı değişmez.`}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TextInput
        placeholder="Adres"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={addressText}
        onChangeText={setAddressText}
      />
      <TextInput
        placeholder="Enlem"
        placeholderTextColor={colors.muted}
        keyboardType="decimal-pad"
        style={styles.input}
        value={lat}
        onChangeText={setLat}
      />
      <TextInput
        placeholder="Boylam"
        placeholderTextColor={colors.muted}
        keyboardType="decimal-pad"
        style={styles.input}
        value={lng}
        onChangeText={setLng}
      />
      {mode === 'delivery' ? (
        <>
          <TextInput
            placeholder="Teslim alacak kişi"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={receiverName}
            onChangeText={setReceiverName}
          />
          <TextInput
            placeholder="Telefon +90…"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            style={styles.input}
            value={receiverPhone}
            onChangeText={setReceiverPhone}
          />
        </>
      ) : null}
      {mode === 'delivery' && plan?.deliveryOverride ? (
        <Text style={styles.meta}>
          Mevcut talep: {plan.deliveryOverride.status}
          {plan.deliveryOverride.otpCode ? ` · kod ${plan.deliveryOverride.otpCode}` : ''}
        </Text>
      ) : null}
      <Pressable disabled={busy} onPress={() => void submit()} style={styles.cta}>
        <Text style={styles.ctaText}>{busy ? 'Kaydediliyor…' : 'Gönder'}</Text>
      </Pressable>
      {mode === 'delivery' && plan?.deliveryOverride ? (
        <Pressable disabled={busy} onPress={() => void cancelOverride()} style={styles.secondary}>
          <Text style={styles.secondaryText}>Talebi iptal et</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.asphalt },
  content: { padding: space.lg, paddingTop: 56 },
  back: { color: colors.headlamp, marginBottom: space.md },
  title: { color: colors.paper, fontSize: 28, fontWeight: '800' },
  lede: { color: colors.muted, marginTop: 6, marginBottom: space.lg },
  error: { color: colors.danger, marginBottom: space.md },
  meta: { color: colors.headlamp, marginBottom: space.md },
  input: {
    backgroundColor: colors.steel,
    color: colors.paper,
    borderRadius: 12,
    padding: space.md,
    marginBottom: space.sm,
  },
  cta: {
    backgroundColor: colors.headlamp,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
  },
  ctaText: { color: colors.asphalt, fontWeight: '800' },
  secondary: { marginTop: space.md, alignItems: 'center', padding: space.md },
  secondaryText: { color: colors.headlamp, fontWeight: '700' },
});
