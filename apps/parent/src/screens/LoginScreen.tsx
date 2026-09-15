import { useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  AuthIntro,
  Surface,
  Button,
  Field,
  IconButton,
  InlineAlert,
  Screen,
  space,
} from '@servisapp/ui';
import { ApiError } from '../api/client';
import {
  authClientAvailable,
  devPasswordLoginEnabled,
  loginWithPassword,
  requestPhoneOtp,
  verifyPhoneOtp,
} from '../auth';
import type { ParentSession } from '../api/client';

export function LoginScreen({
  onLoggedIn,
  onOpenInvite,
}: {
  onLoggedIn: (session: ParentSession) => void;
  onOpenInvite: () => void;
}) {
  const otpReady = authClientAvailable();
  const showDevPassword = devPasswordLoginEnabled() || (!otpReady && __DEV__);
  const [phone, setPhone] = useState('+90');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState<'idle' | 'otp' | 'password'>('idle');
  const [error, setError] = useState<string | null>(null);
  /**
   * Kimliği henüz bağlanmamış veli.
   *
   * Sunucu doğru davranır: veli üyeliği yalnız davet aktivasyonuyla açılır
   * (SPEC onboarding). Ama ekranda bu, çıkışı olmayan kırmızı bir kutuydu —
   * "Bu hesap henüz tanımlanmamış" deyip susuyordu. Çözümü olan tek işlem
   * kartın altında, sayfayı kaydırınca görünen soluk bir bağlantıydı.
   */
  const [needsInvite, setNeedsInvite] = useState(false);

  function failFrom(caught: unknown, fallback: string): void {
    const notProvisioned =
      caught instanceof ApiError &&
      (caught.code === 'identity_not_provisioned' || caught.status === 403);
    setNeedsInvite(notProvisioned);
    if (notProvisioned) {
      setError('Numaran kayıtlı ama hesabın henüz açılmadı. Davetini onaylaman gerekiyor.');
      return;
    }
    setError(caught instanceof ApiError ? caught.message : fallback);
  }

  async function sendCode() {
    setBusy('otp');
    setError(null);
    setNeedsInvite(false);
    try {
      const e164 = await requestPhoneOtp(phone);
      setPhone(e164);
      setStep('code');
    } catch (caught) {
      failFrom(caught, 'Kod gönderilemedi');
    } finally {
      setBusy('idle');
    }
  }

  async function verifyCode() {
    setBusy('otp');
    setError(null);
    setNeedsInvite(false);
    try {
      onLoggedIn(await verifyPhoneOtp(phone, code));
    } catch (caught) {
      failFrom(caught, 'Giriş başarısız');
    } finally {
      setBusy('idle');
    }
  }

  async function submitDevPassword() {
    setBusy('password');
    setError(null);
    setNeedsInvite(false);
    try {
      onLoggedIn(await loginWithPassword(phone.trim(), password));
    } catch (caught) {
      failFrom(caught, 'Giriş başarısız');
    } finally {
      setBusy('idle');
    }
  }

  return (
    <Screen scroll keyboard>
      <AuthIntro
        audience="Aile"
        title={'Her yolculukta,\nyanında.'}
        body="Servis yolculuğunu takip et, günlük planını kolayca yönet."
      />
      <Surface>
        <Field
          label="Telefon numaran"
          autoComplete="tel"
          helper="Servise kayıtlı telefon numaranı kullan."
          autoCapitalize="none"
          autoCorrect={false}
          editable={step === 'phone'}
          keyboardType="phone-pad"
          placeholder="+90532…"
          value={phone}
          onChangeText={setPhone}
        />

        {otpReady && step === 'code' ? (
          <Field
            label="Doğrulama kodu"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
            keyboardType="number-pad"
            placeholder="6 haneli kod"
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
          />
        ) : null}

        {showDevPassword ? (
          <Field
            label="Geliştirici parolası"
            secureTextEntry
            placeholder="En az 16 karakter"
            value={password}
            onChangeText={setPassword}
          />
        ) : null}

        {error ? (
          <InlineAlert
            title={error}
            tone={needsInvite ? 'warn' : 'danger'}
            body={
              needsInvite
                ? 'SMS ile gelen davet bağlantısını aç; telefon doğrulamasından sonra çocukların burada görünür.'
                : undefined
            }
          />
        ) : null}
        {needsInvite ? (
          <Button label="Davetimi aç" onPress={onOpenInvite} style={styles.dev} />
        ) : null}

        {otpReady && step === 'phone' ? (
          <Button
            label="Doğrulama kodu al"
            disabled={phone.length < 8}
            loading={busy === 'otp'}
            onPress={() => void sendCode()}
          />
        ) : null}

        {otpReady && step === 'code' ? (
          <Button
            label="Güvenle giriş yap"
            disabled={code.length < 6}
            loading={busy === 'otp'}
            onPress={() => void verifyCode()}
          />
        ) : null}

        {showDevPassword ? (
          <Button
            label={otpReady ? 'Yerel parola ile gir' : 'Giriş'}
            variant={otpReady ? 'secondary' : 'primary'}
            disabled={phone.length < 8 || password.length < 16}
            loading={busy === 'password'}
            onPress={() => void submitDevPassword()}
            style={styles.dev}
          />
        ) : null}

        {!otpReady && !showDevPassword ? (
          <InlineAlert
            title="Giriş yapılandırması eksik"
            body="Supabase Auth veya yerel parola gerekir."
            tone="danger"
          />
        ) : null}

        {otpReady && step === 'code' ? (
          <IconButton
            label="Telefon numarasını değiştir"
            disabled={busy !== 'idle'}
            onPress={() => {
              setStep('phone');
              setCode('');
              setError(null);
            }}
          />
        ) : null}
      </Surface>
      <IconButton
        label="İlk kez mi geldin? Davetini aç"
        onPress={onOpenInvite}
        style={styles.invite}
      />
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
  dev: {
    marginTop: space.sm,
  },
  invite: {
    alignSelf: 'center',
    marginTop: space.md,
  },
});
