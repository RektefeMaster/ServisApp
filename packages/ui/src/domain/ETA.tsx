import { AppText } from '../primitives/AppText';
import { colors } from '../theme';

/** Tek ETA formatlama yüzeyi — raw domain string'i olduğu gibi gösterebilir. */
export function ETA({ text, size = 'regular' }: { text: string; size?: 'regular' | 'large' }) {
  return (
    <AppText
      preset={size === 'large' ? 'display' : 'mono'}
      color={colors.ink}
      accessibilityLabel={text}
    >
      {text}
    </AppText>
  );
}
