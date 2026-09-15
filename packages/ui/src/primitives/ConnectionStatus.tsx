import { View, StyleSheet } from 'react-native';
import { colors, space } from '../theme';
import { AppText } from './AppText';

export type ConnectionMode = 'online' | 'offline' | 'syncProblem';

export function ConnectionStatus({
  mode,
  queueCount = 0,
}: {
  mode: ConnectionMode;
  queueCount?: number;
}) {
  if (mode === 'syncProblem') {
    return (
      <View style={styles.row} accessibilityLabel={`${queueCount} işlem gönderilemedi`}>
        <View style={[styles.dot, { backgroundColor: colors.danger }]} />
        <AppText preset="monoSmall" color={colors.danger}>
          {queueCount} gönderilemedi
        </AppText>
      </View>
    );
  }

  if (mode === 'offline') {
    return (
      <View style={styles.row} accessibilityLabel={`Çevrimdışı, ${queueCount} bekliyor`}>
        <View style={[styles.dot, { backgroundColor: colors.warn }]} />
        <AppText preset="monoSmall" color={colors.warn}>
          {queueCount > 0 ? `Çevrimdışı · ${queueCount}` : 'Çevrimdışı'}
        </AppText>
      </View>
    );
  }

  if (queueCount > 0) {
    return (
      <View style={styles.row} accessibilityLabel={`${queueCount} işlem kuyrukta`}>
        <View style={[styles.dot, { backgroundColor: colors.warn }]} />
        <AppText preset="monoSmall" color={colors.warn}>
          Kuyruk · {queueCount}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.row} accessibilityLabel="Çevrimiçi">
      <View style={[styles.dot, { backgroundColor: colors.ok }]} />
      <AppText preset="caption" color={colors.mute}>
        Çevrimiçi
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});
