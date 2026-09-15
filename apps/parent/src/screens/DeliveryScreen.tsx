import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, type ScrollView, StyleSheet, View } from 'react-native';
import { toPhoneE164 } from '@servisapp/domain';
import type { ParentDayPlan } from '@servisapp/contracts';
import {
  AppText,
  Surface,
  SectionHeading,
  Button,
  Field,
  IconButton,
  InlineAlert,
  Screen,
  FlowHeader,
  ResultCard,
  StatusChip,
  colors,
  space,
  useHardwareBack,
} from '@servisapp/ui';
import {
  ApiError,
  cancelDeliveryOverride,
  createAddressChange,
  createDeliveryOverride,
  fetchDayPlan,
  type ParentSession,
} from '../api/client';
import { deliveryOverrideLabel, parseLocationInput } from '../status';

function todayIstanbul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}
type Errors = Partial<Record<'address' | 'location' | 'name' | 'phone', string>>;

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
  const [addressText, setAddressText] = useState('');
  const [locationText, setLocationText] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('+90');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [result, setResult] = useState<{ title: string; body: string } | null>(null);
  const lock = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [review, result]);
  const delivery = mode === 'delivery';

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlan(await fetchDayPlan(session, studentId));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSessionInvalid();
      else
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Güncel plan alınamadı. Bağlantını kontrol edip yeniden dene.',
        );
    } finally {
      setLoading(false);
    }
  }, [onSessionInvalid, session, studentId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useHardwareBack(() => {
    if (busy) return;
    if (review && !result) {
      setReview(false);
      return;
    }
    onBack();
  });

  function validate() {
    const next: Errors = {};
    if (addressText.trim().length < 3) next.address = 'Sokak, bina numarası ve adres tarifini yaz.';
    if (!parseLocationInput(locationText))
      next.location = /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(locationText)
        ? 'Bu kısa bağlantı okunamıyor. Haritadaki koordinatları kopyalayıp yapıştır.'
        : 'Geçerli koordinat (ör. 41.01, 29.02) veya tam harita bağlantısı gir.';
    if (delivery && receiverName.trim().length < 2)
      next.name = 'Teslim alacak kişinin adını ve soyadını yaz.';
    if (delivery && !toPhoneE164(receiverPhone))
      next.phone = 'Geçerli bir telefon numarası gir. Örnek: 0532 123 45 67.';
    setFieldErrors(next);
    if (Object.keys(next).length > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setError(null);
    setReview(true);
  }

  async function submit() {
    const coords = parseLocationInput(locationText);
    const phone = toPhoneE164(receiverPhone);
    if (!plan || !coords || (delivery && !phone) || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (delivery && phone) {
        const saved = await createDeliveryOverride(session, {
          studentId,
          serviceDate: todayIstanbul(),
          ...coords,
          addressText: addressText.trim(),
          receiverName: receiverName.trim(),
          receiverPhone: phone,
        });
        setResult({
          title: deliveryOverrideLabel(saved.status),
          body:
            saved.status === 'PENDING_APPROVAL'
              ? `${studentName} için talebin alındı. Yönetici onayından sonra teslim kodu alıcıya gönderilecek.`
              : `${studentName} için teslimat kaydedildi.${saved.otpSentTo ? ` Kod ${saved.otpSentTo} numarasına gönderildi.` : 'Güncel teslimat durumunu çocuk ekranından takip edebilirsin.'}`,
        });
      } else {
        const saved = await createAddressChange(session, {
          studentId,
          ...coords,
          addressText: addressText.trim(),
          effectiveFromDate: todayIstanbul(),
        });
        setResult({
          title: saved.status === 'APPROVED' ? 'Adres talebi onaylandı' : 'Adres talebin alındı',
          body: `${studentName} için ${saved.addressText} adresi kaydedildi. ${saved.status === 'APPROVED' ? 'Güncel planını çocuk ekranından kontrol edebilirsin.' : 'Talebin yönetici tarafından değerlendirilecek. Onaylı seferin anında değişmez.'}`,
        });
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSessionInvalid();
      else
        setError(
          caught instanceof ApiError
            ? caught.message
            : 'Talep gönderilemedi. Bilgilerin korundu; yeniden deneyebilirsin.',
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function cancelOverride() {
    const overrideId = plan?.deliveryOverride?.id;
    if (!overrideId || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await cancelDeliveryOverride(session, overrideId);
      setResult({
        title: 'Teslimat talebi iptal edildi',
        body: `${studentName} için bugüne özel teslimat talebi geri alındı. Güncel planı çocuk ekranından kontrol edebilirsin.`,
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSessionInvalid();
      else
        setError(
          caught instanceof ApiError ? caught.message : 'Talep iptal edilemedi. Yeniden dene.',
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const override = delivery ? plan?.deliveryOverride : null;
  const currentOverride =
    override && ['ACTIVE', 'PENDING_APPROVAL', 'LOCKED'].includes(override.status);
  const footer = result ? (
    <Button label="Çocuğun planına dön" onPress={onBack} />
  ) : plan && !loading ? (
    currentOverride ? (
      <Button
        label="Talebi iptal et"
        variant="secondary"
        onPress={() => void cancelOverride()}
        loading={busy}
      />
    ) : (
      <>
        <AppText preset="caption">
          {review
            ? 'Bilgileri kontrol ettikten sonra gönder.'
            : delivery
              ? 'Yalnızca bugünkü teslimat için geçerli.'
              : 'Kalıcı adres güncellemesi talebi.'}
        </AppText>
        <Button
          label={review ? 'Talebi gönder' : 'Bilgileri kontrol et'}
          onPress={review ? () => void submit() : validate}
          loading={busy}
        />
        {review ? (
          <Button
            label="Bilgileri düzenle"
            variant="ghost"
            disabled={busy}
            onPress={() => setReview(false)}
          />
        ) : null}
      </>
    )
  ) : undefined;

  return (
    <Screen scroll keyboard scrollRef={scrollRef} footer={footer}>
      <IconButton
        label={review && !result ? '← Bilgileri düzenle' : '← Çocuğun planı'}
        disabled={busy}
        onPress={() => (review && !result ? setReview(false) : onBack())}
        style={styles.back}
      />
      <FlowHeader
        title={delivery ? 'Farklı teslimat' : 'Adres değişikliği'}
        icon={delivery ? 'people' : 'pin'}
        context={`${studentName} · ${delivery ? 'Bugün' : 'Kalıcı talep'}`}
        description={
          delivery
            ? 'Nereye ve kime teslim edileceğini belirle.'
            : 'Yeni adresini servis ekibine ilet.'
        }
        steps={result || currentOverride ? undefined : ['Bilgiler', 'Kontrol']}
        step={review ? 1 : 0}
      />
      {result ? (
        <ResultCard {...result} />
      ) : (
        <>
          {error ? <InlineAlert title={error} tone="danger" /> : null}
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.rail} />
              <AppText preset="meta">Güncel plan kontrol ediliyor…</AppText>
            </View>
          ) : !plan ? (
            <Button label="Yeniden dene" onPress={() => void reload()} variant="secondary" />
          ) : currentOverride ? (
            <Surface>
              <StatusChip
                label={deliveryOverrideLabel(override.status)}
                tone={override.status === 'ACTIVE' ? 'ok' : 'warn'}
              />
              <SectionHeading title="Mevcut teslimat talebi" />
              <SummaryRow label="Adres" value={override.addressText} />
              <SummaryRow label="Teslim alacak kişi" value={override.receiverName} />
              <AppText preset="meta">
                {override.otpSentTo
                  ? `Teslim kodu ${override.otpSentTo} numarasına gönderildi.`
                  : 'Teslimat durumunu çocuğun planından takip edebilirsin.'}
              </AppText>
              <AppText preset="meta" style={styles.note}>
                Değiştirmek için mevcut talebi iptal edip yeni talep oluştur.
              </AppText>
            </Surface>
          ) : review ? (
            <>
              <SectionHeading
                title="Talep özeti"
                detail={delivery ? 'Bugüne özel' : 'Kalıcı adres'}
              />
              <Surface>
                <SummaryRow label="Öğrenci" value={studentName} />
                <SummaryRow label="Adres" value={addressText.trim()} />
                <SummaryRow
                  label="Konum"
                  value={`${parseLocationInput(locationText)?.lat}, ${parseLocationInput(locationText)?.lng}`}
                />
                {delivery ? (
                  <>
                    <SummaryRow label="Teslim alacak kişi" value={receiverName.trim()} />
                    <SummaryRow
                      label="Kodun gönderileceği telefon"
                      value={toPhoneE164(receiverPhone) ?? receiverPhone}
                    />
                  </>
                ) : null}
              </Surface>
              <InlineAlert
                title={delivery ? 'Teslim kodu alıcıya gider' : 'Talebin değerlendirmeye alınacak'}
                body={
                  delivery
                    ? 'Gerekirse yönetici onayı beklenir. Kod alıcının telefonuna SMS ile gönderilir; uygulamada gösterilmez.'
                    : 'Onaylı seferler anında değişmez. Yeni adresin uygunluğu yönetici tarafından kontrol edilir.'
                }
              />
            </>
          ) : (
            <>
              <SectionHeading title={delivery ? 'Teslimat adresi' : 'Yeni adres'} />
              <Surface>
                <Field
                  label="Açık adres"
                  value={addressText}
                  onChangeText={setAddressText}
                  placeholder="Mahalle, sokak, bina no"
                  // Otomatik düzeltme sokak ve mahalle adlarını değiştiriyor
                  // ("Bağdat" → "Baghdad"): bu metni kapıda şoför okuyor.
                  autoCorrect={false}
                  autoCapitalize="words"
                  multiline
                  maxLength={500}
                  error={fieldErrors.address}
                />
                <Field
                  label="Harita konumu"
                  value={locationText}
                  onChangeText={setLocationText}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  placeholder="41.01, 29.02 veya tam harita bağlantısı"
                  error={fieldErrors.location}
                  helper="Haritada adresine basılı tutup koordinatları kopyala. Kısa harita bağlantıları desteklenmiyor."
                />
              </Surface>
              {delivery ? (
                <>
                  <SectionHeading title="Teslim alacak kişi" />
                  <Surface>
                    <Field
                      label="Ad soyad"
                      value={receiverName}
                      onChangeText={setReceiverName}
                      placeholder="Teslim alacak kişinin adı"
                      autoComplete="name"
                      maxLength={120}
                      error={fieldErrors.name}
                    />
                    <Field
                      label="Cep telefonu"
                      value={receiverPhone}
                      onChangeText={setReceiverPhone}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      placeholder="0532 123 45 67"
                      error={fieldErrors.phone}
                      helper="Teslim kodu bu kişinin telefonuna gönderilecek."
                    />
                  </Surface>
                </>
              ) : null}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <AppText preset="caption">{label}</AppText>
      <AppText preset="strong">{value}</AppText>
    </View>
  );
}
const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', marginBottom: space.sm, paddingHorizontal: 0 },
  loading: { padding: space.xl, alignItems: 'center', gap: space.md },
  summaryRow: { gap: space.xxs, paddingBottom: space.md },
  note: { marginTop: space.md },
});
