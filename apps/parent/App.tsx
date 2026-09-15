import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { parseInviteToken } from '@servisapp/domain';
import { colors, useManifestFonts } from '@servisapp/ui';
import type { ParentSession } from './src/api/client';
import { clearSession, restoreSession } from './src/auth';
import { registerParentPush } from './src/push';
import { AbsentScreen } from './src/screens/AbsentScreen';
import { ChildScreen } from './src/screens/ChildScreen';
import { DeliveryScreen } from './src/screens/DeliveryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LiveMapScreen } from './src/screens/LiveMapScreen';
import { InviteScreen } from './src/screens/InviteScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';

type Route =
  | { name: 'login' }
  | { name: 'invite'; token: string | null }
  | { name: 'home' }
  | { name: 'live'; tripId: string; studentId: string; studentName: string }
  | { name: 'child'; studentId: string; studentName: string }
  | { name: 'absent'; studentId: string; studentName: string }
  | { name: 'delivery'; studentId: string; studentName: string }
  | { name: 'address'; studentId: string; studentName: string }
  | { name: 'profile' };

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
  const [session, setSession] = useState<ParentSession | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'login' });

  useEffect(() => {
    void (async () => {
      const restored = await restoreSession();
      if (restored) {
        setSession(restored);
        setRoute({ name: 'home' });
        void registerParentPush(restored);
      } else {
        // Veli SMS'teki daveti tıklayarak geldiyse jetonla doğrudan aktivasyona
        // düşer; oturumu olan veliyi davet ekranı rahatsız etmez.
        const initialUrl = await Linking.getInitialURL();
        const token = initialUrl ? parseInviteToken(initialUrl) : null;
        if (token) setRoute({ name: 'invite', token });
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', (event) => {
      const token = parseInviteToken(event.url);
      // Oturumlu veliyi canlı takipten koparma.
      if (token && !session) setRoute({ name: 'invite', token });
    });
    return () => {
      subscription.remove();
    };
  }, [session]);

  if (!ready || !fontsLoaded) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.rail} />
        <StatusBar style="dark" />
      </View>
    );
  }

  if (route.name === 'invite') {
    return (
      <>
        <InviteScreen
          /**
           * Jeton değişince ekran YENİDEN kurulur. Davet ekranı zaten açıkken
           * SMS bağlantısına dokunan veli için `initialToken` prop'u değişiyor
           * ama bileşen içindeki `useState(initialToken)` bir daha okunmuyordu:
           * bağlantı sessizce yutuluyor, alan boş kalıyordu.
           */
          key={route.token ?? 'manuel'}
          initialToken={route.token}
          onActivated={(next) => {
            setSession(next);
            setRoute({ name: 'home' });
            void registerParentPush(next);
          }}
          onCancel={() => setRoute({ name: 'login' })}
        />
        <StatusBar style="dark" />
      </>
    );
  }

  if (!session || route.name === 'login') {
    return (
      <>
        <LoginScreen
          onLoggedIn={(next) => {
            setSession(next);
            setRoute({ name: 'home' });
            void registerParentPush(next);
          }}
          onOpenInvite={() => setRoute({ name: 'invite', token: null })}
        />
        <StatusBar style="dark" />
      </>
    );
  }

  if (route.name === 'live') {
    return (
      <>
        <LiveMapScreen
          session={session}
          tripId={route.tripId}
          studentId={route.studentId}
          studentName={route.studentName}
          onBack={() => setRoute({ name: 'home' })}
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

  if (route.name === 'child') {
    return (
      <>
        <ChildScreen
          session={session}
          studentId={route.studentId}
          studentName={route.studentName}
          onBack={() => setRoute({ name: 'home' })}
          onAbsent={() =>
            setRoute({ name: 'absent', studentId: route.studentId, studentName: route.studentName })
          }
          onDelivery={() =>
            setRoute({
              name: 'delivery',
              studentId: route.studentId,
              studentName: route.studentName,
            })
          }
          onAddress={() =>
            setRoute({
              name: 'address',
              studentId: route.studentId,
              studentName: route.studentName,
            })
          }
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

  if (route.name === 'absent') {
    return (
      <>
        <AbsentScreen
          session={session}
          studentId={route.studentId}
          studentName={route.studentName}
          onBack={() =>
            setRoute({ name: 'child', studentId: route.studentId, studentName: route.studentName })
          }
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

  if (route.name === 'delivery' || route.name === 'address') {
    return (
      <>
        <DeliveryScreen
          session={session}
          studentId={route.studentId}
          studentName={route.studentName}
          mode={route.name === 'delivery' ? 'delivery' : 'address'}
          onBack={() =>
            setRoute({ name: 'child', studentId: route.studentId, studentName: route.studentName })
          }
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

  if (route.name === 'profile') {
    return (
      <>
        <ProfileScreen
          session={session}
          onBack={() => setRoute({ name: 'home' })}
          onLogout={() => {
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
      <HomeScreen
        session={session}
        onOpenLive={(tripId, studentId, studentName) =>
          setRoute({ name: 'live', tripId, studentId, studentName })
        }
        onOpenChild={(studentId, studentName) =>
          setRoute({ name: 'child', studentId, studentName })
        }
        onOpenProfile={() => setRoute({ name: 'profile' })}
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
