import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, elevation, radius, space } from '../theme';
import { AppText } from './AppText';
import { IconButton } from './IconButton';

export type SheetLevel = 'standard' | 'action' | 'critical';

type BottomSheetProps = {
  visible: boolean;
  level?: SheetLevel;
  title: string;
  onClose?: () => void;
  children: ReactNode;
  /** Critical sheet'lerde kapatma opsiyonel olarak kapatılabilir. */
  dismissible?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function BottomSheet({
  visible,
  level = 'standard',
  title,
  onClose,
  children,
  dismissible,
  style,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const canDismiss = dismissible ?? level !== 'critical';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={canDismiss ? onClose : () => {}}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {canDismiss ? (
          <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Kapat" />
        ) : (
          <View style={styles.scrim} />
        )}
        <View
          style={[
            styles.sheet,
            elevation.sheet,
            { paddingBottom: Math.max(space.xxl, insets.bottom + space.md) },
            level === 'critical' ? styles.critical : null,
            style,
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <AppText
              preset="section"
              color={level === 'critical' ? colors.danger : colors.ink}
              style={styles.title}
            >
              {title}
            </AppText>
            {canDismiss && onClose ? <IconButton label="Kapat" onPress={onClose} /> : null}
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: space.xs }}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(24, 30, 26, 0.42)',
  },
  scrim: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
    maxHeight: '88%',
  },
  critical: {
    borderTopWidth: 3,
    borderTopColor: colors.danger,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.md,
    gap: space.sm,
  },
  title: {
    flex: 1,
  },
});
