import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors, useManifestFonts } from '@servisapp/ui';
import type { CrewSession } from './src/api/client';
import { clearSession, restoreSupabaseSession } from './src/auth';
import { openOutbox } from './src/outbox';
import { LoginScreen } from './src/screens/LoginScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { TripScreen } from './src/screens/TripScreen';

type Route = { name: 'login' } | { name: 'today' } | { name: 'trip'; tripId: string };

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const fontsLoaded = useManifestFonts();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CrewSession | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'login' });

  useEffect(() => {
    void (async () => {
      try {
        await openOutbox();
        const restored = await restoreSupabaseSession();
        if (restored) {
          setSession(restored);
          setRoute({ name: 'today' });
        }
      } catch {
        // Kuyruk/depolama okunamıyorsa giriş ekranı yine açılabilir.
      } finally {
        // Kuyruk/depolama arızası yüzünden sonsuz açılış göstergesi kalmasın.
        setReady(true);
      }
    })();
  }, []);

  if (!ready || !fontsLoaded) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.rail} />
        <StatusBar style="dark" />
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
        <StatusBar style="dark" />
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
        <StatusBar style="dark" />
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
      <StatusBar style="dark" />
    </>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
