import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, space } from '../theme';

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.line, style]} />;
}

const styles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginVertical: space.sm,
  },
});
