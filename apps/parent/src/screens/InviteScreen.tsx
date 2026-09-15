import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { parseInviteToken } from '@servisapp/domain';
import {
  AppText,
  AuthIntro,
  Button,
  Field,
  IconButton,
  InlineAlert,
  Screen,
  colors,
  space,
  useHardwareBack,
} from '@servisapp/ui';
import {
  ApiError,
  fetchInvitePreview,
  type InvitePreview,
  type ParentSession,
} from '../api/client';
import { activateInviteWithOtp, authClientAvailable, requestPhoneOtp } from '../auth';

/**
 * Davetli velinin ilk açılışı. Link tek başına yetki vermez; ekran önce daveti
 * gösterir, sonra kayıtlı numaraya SMS kodu gönderir, kod doğrulanınca daveti
 * aktive eder.
 */
export function InviteScreen({
  initialToken,
  onActivated,
  onCancel,
}: {
  initialToken: string | null;
  onActivated: (session: ParentSession) => void;
  onCancel: () => void;
}) {
  const otpReady = authClientAvailable();
  const [linkText, setLinkText] = useState(initialToken ?? '');
  const [token, setToken] = useState<string | null>(initialToken);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [phone, setPhone] = useState('+90');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kod adımından telefon adımına, oradan girişe: geri tuşu adım adım geriler.
  useHardwareBack(() => {
    if (busy) return;
    if (step === 'code') setStep('phone');
    else onCancel();
  });

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setBusy(true);
    setError(null);
    void fetchInvitePreview(token)
      .then((result) => {
        if (alive) setPreview(result);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setPreview(null);
        setError(caught instanceof ApiError ? caught.message : 'Davet okunamadı');
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [token, previewAttempt]);

  function useLink() {
    const parsed = parseInviteToken(linkText);
    if (!parsed) {
      setError('Bağlantı okunamadı. SMS’teki linki olduğu gibi yapıştırın.');
      return;
    }
    setError(null);
    setPreview(null);
    setToken(parsed);
    setPreviewAttempt((value) => value + 1);
  }

  function retryPreview() {
    if (!token) return;
    setPreview(null);
    setError(null);
    setPreviewAttempt((value) => value + 1);
  }

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const e164 = await requestPhoneOtp(phone);
      setPhone(e164);
      setStep('code');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Kod gönderilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      onActivated(await activateInviteWithOtp(token, phone, code));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Davet aktive edilemedi');
    } finally {
      setBusy(false);
    }
  }

  const usable = preview?.status === 'PENDING';

  return (
    <Screen scroll keyboard>
      <AuthIntro
        audience="Aile"
        title={preview ? preview.tenantName : 'Hoş geldin.'}
        body="Davetini onayla, çocuğunun yolculuğuna bağlan."
      />

      {!token ? (
        <>
          <AppText preset="meta" style={styles.lede}>
            SMS ile gelen bağlantıyı yapıştır. Kimliğini telefon doğrulaması kanıtlar.
          </AppText>
          <Field
            label="Davet bağlantısı"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder="https://…/i/…"
            value={linkText}
            onChangeText={setLinkText}
          />
          {error ? <InlineAlert title={error} tone="danger" /> : null}
          <Button label="Daveti aç" disabled={linkText.trim().length < 8} onPress={useLink} />
        </>
      ) : null}

      {token && busy && !preview ? (
        <ActivityIndicator color={colors.rail} style={styles.loader} />
      ) : null}

      {token && !busy && !preview ? (
        <>
          <InlineAlert
            title={error ?? 'Davet okunamadı'}
            body="Bağlantınızı kontrol edip tekrar deneyin."
            tone="danger"
          />
          <Button label="Tekrar dene" onPress={retryPreview} />
        </>
      ) : null}

      {token && preview && !usable ? (
        <>
          <AppText preset="meta" style={styles.lede}>
            {preview.status === 'USED'
              ? 'Bu davet daha önce kullanılmış. Aşağıdan normal giriş yapabilirsin.'
              : 'Bu davet artık geçerli değil. Servis şirketinden yeni davet iste.'}
          </AppText>
          {error ? <InlineAlert title={error} tone="danger" /> : null}
        </>
      ) : null}

      {token && usable ? (
        <>
          <AppText preset="meta" style={styles.lede}>
            Kayıtlı numara {preview.phoneHint}. Aynı numarayla kod al; doğrulanınca çocuğunun
            servisi hesabına bağlanır.
          </AppText>
          {!otpReady ? (
            <InlineAlert
              title="Telefon doğrulaması yapılandırılmamış"
              body="Servis şirketini ara."
              tone="danger"
            />
          ) : null}
          <Field
            label="Telefon"
            autoCapitalize="none"
            autoCorrect={false}
            editable={step === 'phone'}
            keyboardType="phone-pad"
            placeholder="+90532…"
            value={phone}
            onChangeText={setPhone}
          />
          {step === 'code' ? (
            <Field
              label="SMS kodu"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={6}
              keyboardType="number-pad"
              placeholder="6 haneli kod"
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
            />
          ) : null}
          {error ? <InlineAlert title={error} tone="danger" /> : null}
          {step === 'phone' ? (
            <Button
              label="Kod gönder"
              disabled={!otpReady || phone.length < 8}
              loading={busy}
              onPress={() => void sendCode()}
            />
          ) : (
            <Button
              label="Daveti onayla"
              disabled={code.length < 6}
              loading={busy}
              onPress={() => void activate()}
            />
          )}
          {step === 'code' ? (
            <IconButton
              label="Telefon numarasını değiştir"
              disabled={busy}
              onPress={() => {
                setStep('phone');
                setCode('');
                setError(null);
              }}
            />
          ) : null}
        </>
      ) : null}

      <IconButton label="Girişe dön" onPress={onCancel} style={styles.secondary} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: space.xs,
  },
  lede: {
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  loader: {
    marginVertical: space.lg,
  },
  secondary: {
    alignSelf: 'center',
    marginTop: space.md,
  },
});
