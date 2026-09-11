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
import { exhaustive } from '@servisapp/domain';
import { colors, space } from '@servisapp/ui';
import { ApiError } from '../api/client';
import {
  finishMembershipChoice,
  loginWithPassword,
  type CrewMembershipChoice,
} from '../auth';
import type { CrewSession } from '../api/client';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (session: CrewSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<{
    token: string;
    fullName: string;
    memberships: CrewMembershipChoice[];
  } | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await loginWithPassword(email.trim(), password);
      switch (result.status) {
        case 'choose':
          setChoice({
            token: result.token,
            fullName: result.fullName,
            memberships: result.memberships,
          });
          return;
        case 'ready':
          onLoggedIn(result.session);
          return;
        default: {
          const unexpected: never = result;
          exhaustive(unexpected, 'loginWithPassword');
        }
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Giriş başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function choose(membership: CrewMembershipChoice) {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const session = await finishMembershipChoice(choice.token, choice.fullName, membership);
      onLoggedIn(session);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Şirket seçilemedi');
    } finally {
      setBusy(false);
    }
  }

  if (choice) {
    return (
      <View style={styles.screen}>
        <Text style={styles.eyebrow}>ŞİRKET</Text>
        <Text style={styles.title}>Hangisinde çalışıyorsun?</Text>
        <Text style={styles.lede}>Aynı telefon birden fazla servis şirketinde olabilir.</Text>
        {choice.memberships.map((item) => (
          <Pressable
            key={item.membershipId}
            disabled={busy}
            onPress={() => void choose(item)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{item.tenantName}</Text>
          </Pressable>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.eyebrow}>PERSONEL</Text>
      <Text style={styles.title}>ServisApp</Text>
      <Text style={styles.lede}>Şoför ve hostes sefer ekranı. Veli hesabı buradan girmez.</Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="E-posta"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        autoComplete="password"
        placeholder="Parola"
        placeholderTextColor={colors.muted}
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable disabled={busy} onPress={() => void submit()} style={styles.button}>
        {busy ? <ActivityIndicator color={colors.asphalt} /> : <Text style={styles.buttonText}>Giriş</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.asphalt,
    padding: space.lg,
    justifyContent: 'center',
  },
  eyebrow: {
    color: colors.headlamp,
    letterSpacing: 4,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: space.sm,
  },
  title: {
    color: colors.paper,
    fontSize: 36,
    fontWeight: '800',
    marginBottom: space.sm,
  },
  lede: {
    color: colors.muted,
    fontSize: 16,
    marginBottom: space.lg,
  },
  input: {
    backgroundColor: colors.steel,
    color: colors.paper,
    borderRadius: 12,
    padding: space.md,
    fontSize: 18,
    marginBottom: space.sm,
  },
  error: {
    color: colors.danger,
    marginBottom: space.sm,
  },
  button: {
    backgroundColor: colors.headlamp,
    borderRadius: 14,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
  },
  buttonText: {
    color: colors.asphalt,
    fontSize: 18,
    fontWeight: '800',
  },
});
