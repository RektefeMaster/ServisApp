import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '@servisapp/ui';
import type { CrewSession } from './src/api/client';
import { clearSession, restoreSupabaseSession } from './src/auth';
import { openOutbox } from './src/outbox';
import { LoginScreen } from './src/screens/LoginScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { TripScreen } from './src/screens/TripScreen';

type Route = { name: 'login' } | { name: 'today' } | { name: 'trip'; tripId: string };

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CrewSession | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'login' });

  useEffect(() => {
    void (async () => {
      await openOutbox();
      const restored = await restoreSupabaseSession();
      if (restored) {
        setSession(restored);
        setRoute({ name: 'today' });
      }
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.headlamp} />
        <StatusBar style="light" />
      </View>
    );
  }

  if (!session || route.name === 'login') {
    return (
      <>
        <LoginScreen
          onLoggedIn={(next) => {
            setSession(next);
            setRoute({ name: 'today' });
          }}
        />
        <StatusBar style="light" />
      </>
    );
  }

  if (route.name === 'trip') {
    return (
      <>
        <TripScreen
          session={session}
          tripId={route.tripId}
          onBack={() => setRoute({ name: 'today' })}
          onSessionInvalid={() => {
            void clearSession();
            setSession(null);
            setRoute({ name: 'login' });
          }}
        />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <>
      <TodayScreen
        session={session}
        onOpenTrip={(tripId) => setRoute({ name: 'trip', tripId })}
        onLogout={() => {
          void clearSession();
          setSession(null);
          setRoute({ name: 'login' });
        }}
        onSessionInvalid={() => {
          void clearSession();
          setSession(null);
          setRoute({ name: 'login' });
        }}
      />
      <StatusBar style="light" />
    </>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.asphalt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
