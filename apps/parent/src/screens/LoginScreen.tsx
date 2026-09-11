import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { colors, space } from '@servisapp/ui';
import { ApiError } from '../api/client';
import {
  authClientAvailable,
  devPasswordLoginEnabled,
  loginWithPassword,
  requestPhoneOtp,
  verifyPhoneOtp,
} from '../auth';
import type { ParentSession } from '../api/client';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (session: ParentSession) => void }) {
  const otpReady = authClientAvailable();
  const showDevPassword = devPasswordLoginEnabled() || (!otpReady && __DEV__);
  const [phone, setPhone] = useState('+90');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function verifyCode() {
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await verifyPhoneOtp(phone, code));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Giriş başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function submitDevPassword() {
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await loginWithPassword(phone.trim(), password));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Giriş başarısız');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.eyebrow}>VELİ</Text>
      <Text style={styles.title}>Çocuğunun servisi</Text>
      <Text style={styles.lede}>
        {otpReady
          ? 'Telefonuna gelen SMS kodu ile giriş. Canlı konum yalnız senin durağını gösterir.'
          : 'Yerel geliştirici girişi. Üretimde telefon SMS kodu kullanılır.'}
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        editable={step === 'phone'}
        keyboardType="phone-pad"
        placeholder="+90532…"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
      />
      {otpReady && step === 'code' ? (
        <TextInput
          keyboardType="number-pad"
          placeholder="6 haneli kod"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={code}
          onChangeText={setCode}
        />
      ) : null}
      {showDevPassword ? (
        <TextInput
          secureTextEntry
          placeholder="Geliştirici parolası"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={password}
          onChangeText={setPassword}
        />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {otpReady && step === 'phone' ? (
        <Pressable disabled={busy || phone.length < 8} onPress={() => void sendCode()} style={styles.cta}>
          {busy ? <ActivityIndicator color={colors.asphalt} /> : <Text style={styles.ctaText}>Kod gönder</Text>}
        </Pressable>
      ) : null}
      {otpReady && step === 'code' ? (
        <Pressable disabled={busy || code.length < 6} onPress={() => void verifyCode()} style={styles.cta}>
          {busy ? <ActivityIndicator color={colors.asphalt} /> : <Text style={styles.ctaText}>Giriş</Text>}
        </Pressable>
      ) : null}
      {showDevPassword ? (
        <Pressable
          disabled={busy || phone.length < 8 || password.length < 16}
          onPress={() => void submitDevPassword()}
          style={otpReady ? styles.secondary : styles.cta}
        >
          {busy && !otpReady ? (
            <ActivityIndicator color={colors.asphalt} />
          ) : (
            <Text style={otpReady ? styles.secondaryText : styles.ctaText}>
              {otpReady ? 'Yerel parola ile gir' : 'Giriş'}
            </Text>
          )}
        </Pressable>
      ) : null}
      {!otpReady && !showDevPassword ? (
        <Text style={styles.error}>Giriş yapılandırması eksik. Supabase Auth veya yerel parola gerekir.</Text>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.asphalt, padding: space.lg, justifyContent: 'center' },
  eyebrow: { color: colors.headlamp, letterSpacing: 3, fontWeight: '800', marginBottom: space.sm },
  title: { color: colors.paper, fontSize: 32, fontWeight: '800' },
  lede: { color: colors.muted, marginTop: space.sm, marginBottom: space.lg, fontSize: 16 },
  input: {
    backgroundColor: colors.steel,
    color: colors.paper,
    borderRadius: 12,
    padding: space.md,
    marginBottom: space.sm,
    fontSize: 16,
  },
  error: { color: colors.danger, marginBottom: space.sm },
  cta: {
    backgroundColor: colors.headlamp,
    borderRadius: 16,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  ctaText: { color: colors.asphalt, fontSize: 18, fontWeight: '800' },
  secondary: {
    borderRadius: 16,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  secondaryText: { color: colors.muted, fontWeight: '700' },
});
