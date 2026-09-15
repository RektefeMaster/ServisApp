import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { fontScaleCaps, typography, type AppTextPreset } from '../theme';

type AppTextProps = TextProps & {
  preset?: AppTextPreset;
  color?: string;
  style?: StyleProp<TextStyle>;
};

export function AppText({
  preset = 'body',
  color,
  style,
  children,
  maxFontSizeMultiplier,
  ...rest
}: AppTextProps) {
  const base = typography[preset];
  return (
    <Text
      {...rest}
      // Gövde metni sınırsız ölçeklenir; yalnız gösterim tipinin tavanı vardır
      // (bkz. theme.ts `fontScaleCaps`). Çağıran açıkça verirse o kazanır.
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? fontScaleCaps[preset]}
      style={[base, color ? { color } : null, style]}
    >
      {children}
    </Text>
  );
}
