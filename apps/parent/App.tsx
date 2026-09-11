import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '@servisapp/ui';
import type { ParentSession } from './src/api/client';
import { clearSession, restoreSession } from './src/auth';
import { registerParentPush } from './src/push';
import { AbsentScreen } from './src/screens/AbsentScreen';
import { ChildScreen } from './src/screens/ChildScreen';
import { DeliveryScreen } from './src/screens/DeliveryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LiveMapScreen } from './src/screens/LiveMapScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';

type Route =
  | { name: 'login' }
  | { name: 'home' }
  | { name: 'live'; tripId: string; studentId: string; studentName: string }
  | { name: 'child'; studentId: string; studentName: string }
  | { name: 'absent'; studentId: string; studentName: string }
  | { name: 'delivery'; studentId: string; studentName: string }
  | { name: 'address'; studentId: string; studentName: string }
  | { name: 'profile' };

export default function App() {
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
            setRoute({ name: 'home' });
            void registerParentPush(next);
          }}
        />
        <StatusBar style="light" />
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
        <StatusBar style="light" />
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
          onAbsent={() => setRoute({ name: 'absent', studentId: route.studentId, studentName: route.studentName })}
          onDelivery={() => setRoute({ name: 'delivery', studentId: route.studentId, studentName: route.studentName })}
          onAddress={() => setRoute({ name: 'address', studentId: route.studentId, studentName: route.studentName })}
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

  if (route.name === 'absent') {
    return (
      <>
        <AbsentScreen
          session={session}
          studentId={route.studentId}
          studentName={route.studentName}
          onBack={() => setRoute({ name: 'child', studentId: route.studentId, studentName: route.studentName })}
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

  if (route.name === 'delivery' || route.name === 'address') {
    return (
      <>
        <DeliveryScreen
          session={session}
          studentId={route.studentId}
          studentName={route.studentName}
          mode={route.name === 'delivery' ? 'delivery' : 'address'}
          onBack={() => setRoute({ name: 'child', studentId: route.studentId, studentName: route.studentName })}
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
        <StatusBar style="light" />
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
        onOpenChild={(studentId, studentName) => setRoute({ name: 'child', studentId, studentName })}
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
