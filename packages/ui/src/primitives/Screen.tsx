import type { ReactNode, Ref } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout, space } from '../theme';

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  keyboard?: boolean;
  footer?: ReactNode;
  /**
   * Alt gezinme çubuğu. `children` ekranın yatay dolgusunu alır; gezinme
   * çubuğu almaz — eskiden `children` içine konduğu için üst çizgisi iki yanda
   * 20 punto içeride kalıyor, çubuk ekrana oturmuyordu.
   */
  nav?: ReactNode;
  scrollRef?: Ref<ScrollView>;
};

export function Screen({
  children,
  scroll = false,
  padded = true,
  style,
  contentStyle,
  keyboard = false,
  footer,
  nav,
  scrollRef,
}: ScreenProps) {
  const paddingStyle = padded
    ? { paddingHorizontal: layout.screenPaddingX, paddingTop: space.sm }
    : null;

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={[styles.scrollContent, paddingStyle, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.contentWidth, paddingStyle, contentStyle]}>{children}</View>
  );

  const content = (
    <View style={styles.flex}>
      {body}
      {footer ? <View style={[styles.footer, styles.contentWidth]}>{footer}</View> : null}
      {nav ? <View style={styles.contentWidth}>{nav}</View> : null}
    </View>
  );
  const wrapped = keyboard ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
  );

  return <SafeAreaView style={[styles.safe, style]}>{wrapped}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.mist,
  },
  flex: { flex: 1 },
  footer: {
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    padding: space.md,
    gap: space.xs,
  },
  contentWidth: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  scrollContent: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingBottom: space.xxl,
    flexGrow: 1,
  },
});
