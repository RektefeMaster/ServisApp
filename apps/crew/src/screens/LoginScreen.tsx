import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { exhaustive } from '@servisapp/domain';
import { AuthIntro, Surface, Button, Field, InlineAlert, Screen, space } from '@servisapp/ui';
import { ApiError } from '../api/client';
import { finishMembershipChoice, loginWithPassword, type CrewMembershipChoice } from '../auth';
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
      <Screen scroll keyboard contentStyle={styles.content}>
        <AuthIntro
          audience="Ekip"
          title="Şirketini seç."
          body="Bugün çalışacağın servis şirketiyle devam et."
        />
        {choice.memberships.map((item) => (
          <Button
            key={item.membershipId}
            label={item.tenantName}
            disabled={busy}
            onPress={() => void choose(item)}
            style={styles.choice}
          />
        ))}
        {error ? <InlineAlert title={error} tone="danger" /> : null}
      </Screen>
    );
  }

  return (
    <Screen scroll keyboard contentStyle={styles.content}>
      <AuthIntro
        audience="Ekip"
        title={'Güzel bir gün.\nGüvenli bir yolculuk.'}
        body="Seferlerin, durakların ve öğrencilerin. Günün akışı burada."
      />
      <Surface>
        <Field
          label="E-posta"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="ornek@servis.com"
          value={email}
          onChangeText={setEmail}
        />
        <Field
          label="Parola"
          autoComplete="password"
          placeholder="Parola"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          returnKeyType="go"
          onSubmitEditing={() => {
            if (!busy && email.trim() && password) void submit();
          }}
        />
        {error ? <InlineAlert title={error} tone="danger" /> : null}
        <Button
          label="Giriş yap"
          onPress={() => void submit()}
          loading={busy}
          disabled={!email.trim() || !password}
        />
      </Surface>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    justifyContent: 'flex-start',
    paddingBottom: space.xxxl,
  },
  title: {
    marginTop: space.sm,
  },
  lede: {
    marginTop: space.xs,
    marginBottom: space.lg,
  },
  choice: {
    marginBottom: space.sm,
  },
});
