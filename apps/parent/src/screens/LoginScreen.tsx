import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, space } from '@servisapp/ui';
import { ApiError } from '../api/client';
import { loginWithPassword } from '../auth';
import type { ParentSession } from '../api/client';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (session: ParentSession) => void }) {
  const [phone, setPhone] = useState('+90');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const session = await loginWithPassword(phone.trim(), password);
      onLoggedIn(session);
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
      <Text style={styles.lede}>Telefon numarası ile giriş. Canlı konum yalnız senin durağını gösterir.</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="phone-pad"
        placeholder="+90532…"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        secureTextEntry
        placeholder="Parola"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable disabled={busy || phone.length < 8 || password.length < 16} onPress={() => void submit()} style={styles.cta}>
        {busy ? <ActivityIndicator color={colors.asphalt} /> : <Text style={styles.ctaText}>Giriş</Text>}
      </Pressable>
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
});
