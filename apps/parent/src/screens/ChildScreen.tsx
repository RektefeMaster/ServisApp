import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { ParentDayPlan } from '@servisapp/contracts';
import {
  AppText,
  AppIcon,
  ActionRow,
  Avatar,
  SectionHeading,
  StatusChip,
  Surface,
  Button,
  IconButton,
  InlineAlert,
  Screen,
  colors,
  space,
  useHardwareBack,
} from '@servisapp/ui';
import { ApiError, fetchDayPlan, resendDeliveryOtp, type ParentSession } from '../api/client';
import { deliveryOverrideLabel, segmentChip } from '../status';

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
  useHardwareBack(onBack);

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
              deliveryOverride: { ...current.deliveryOverride, otpSentTo: next.otpSentTo },
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
    <Screen scroll>
      <IconButton label="← Ana ekran" onPress={onBack} style={styles.back} />
      <View style={styles.identity}>
        <Avatar name={studentName} large />
        <View style={{ flex: 1, gap: 4 }}>
          <AppText preset="title">{studentName}</AppText>
          <AppText preset="meta">Servis planı ve günlük işlemler</AppText>
        </View>
      </View>
      <SectionHeading title="Bugünün planı" />

      {error ? <InlineAlert title={error} tone="danger" /> : null}
      {!plan && !error ? <ActivityIndicator color={colors.rail} style={styles.loader} /> : null}
      {!plan && error ? (
        <Button label="Tekrar dene" variant="secondary" onPress={() => void reload()} />
      ) : null}

      {plan ? (
        <Surface>
          <View style={styles.planRow}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <AppIcon name="sun" />
              <AppText preset="strong">Sabah · Okula gidiş</AppText>
            </View>
            <StatusChip {...segmentChip(plan.morningPlanStatus, plan.morningAbsent)} />
          </View>
          <View style={styles.planRow}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <AppIcon name="home" />
              <AppText preset="strong">Akşam · Eve dönüş</AppText>
            </View>
            <StatusChip {...segmentChip(plan.eveningPlanStatus, plan.eveningAbsent)} />
          </View>
          {override ? (
            <>
              <AppText preset="strong" style={styles.override}>
                {deliveryOverrideLabel(override.status)}
              </AppText>
              <AppText preset="meta">{override.addressText}</AppText>
              {override.otpSentTo ? (
                <AppText preset="meta" style={styles.otp}>
                  Kod, teslim alacak kişiye ({override.receiverName}, {override.otpSentTo}) SMS ile
                  gitti. Kapıda o kişi söyler — uygulamada görünmez.
                </AppText>
              ) : override.status === 'PENDING_APPROVAL' ? (
                <AppText preset="meta" style={styles.otp}>
                  Yönetici onayından sonra teslim kodu alıcı telefona gider.
                </AppText>
              ) : null}
              {override.status === 'ACTIVE' ? (
                <Button
                  label="Kodu yeniden gönder"
                  variant="ghost"
                  onPress={() => void resend()}
                  loading={busy}
                  style={styles.resend}
                />
              ) : null}
            </>
          ) : (
            <AppText preset="meta">Bugün kayıtlı adrese bırakılacak</AppText>
          )}
        </Surface>
      ) : null}

      <SectionHeading title="Planını düzenle" detail="Hızlı işlemler" />
      <View style={styles.actions}>
        <ActionRow
          index="01"
          title="Bugün kullanmayacak"
          description="Sabah veya akşam için haber ver."
          onPress={onAbsent}
        />
        <ActionRow
          index="02"
          title="Farklı teslimat"
          description="Bugüne özel adres ve teslim alacak kişi."
          onPress={onDelivery}
        />
        <ActionRow
          index="03"
          title="Adres değişikliği"
          description="Kalıcı adres güncellemesi talep et."
          onPress={onAddress}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  planRow: {
    gap: space.xs,
    paddingBottom: space.md,
    marginBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  back: {
    alignSelf: 'flex-start',
    marginBottom: space.xs,
    paddingHorizontal: 0,
  },
  lede: {
    marginTop: space.xxs,
    marginBottom: space.lg,
  },
  loader: { marginVertical: space.md },
  summary: {
    marginBottom: space.lg,
    gap: space.xxs,
  },
  override: {
    marginTop: space.sm,
  },
  otp: {
    marginTop: space.xs,
  },
  resend: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    paddingHorizontal: 0,
  },
  actions: {
    gap: space.sm,
  },
});
