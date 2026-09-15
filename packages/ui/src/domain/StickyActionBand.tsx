import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, elevation, space } from '../theme';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';

type StickyActionBandProps = {
  primaryLabel?: string | null;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  secondaryLabel?: string | null;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
  dangerLabel?: string | null;
  onDanger?: () => void;
  dangerDisabled?: boolean;
  tools?: Array<{ label: string; onPress: () => void; disabled?: boolean }>;
  /** Ölçülen yükseklik; üstüne oturacak bildirim bunu kullanır. */
  onHeight?: (height: number) => void;
  children?: ReactNode;
};

export function StickyActionBand({
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryLoading,
  secondaryLabel,
  onSecondary,
  secondaryDisabled,
  dangerLabel,
  onDanger,
  dangerDisabled,
  tools,
  onHeight,
  children,
}: StickyActionBandProps) {
  return (
    <View
      style={[styles.band, elevation.band]}
      onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)}
    >
      {children}
      {primaryLabel && onPrimary ? (
        <Button
          label={primaryLabel}
          onPress={onPrimary}
          size="crewPrimary"
          disabled={primaryDisabled}
          loading={primaryLoading}
        />
      ) : null}
      {secondaryLabel && onSecondary ? (
        <Button
          label={secondaryLabel}
          onPress={onSecondary}
          variant="secondary"
          disabled={secondaryDisabled}
        />
      ) : null}
      {dangerLabel && onDanger ? (
        <Button
          label={dangerLabel}
          onPress={onDanger}
          variant="danger"
          disabled={dangerDisabled}
          style={styles.danger}
        />
      ) : null}
      {tools && tools.length > 0 ? (
        <View style={styles.tools}>
          {tools.map((tool) => (
            <IconButton
              key={tool.label}
              label={tool.label}
              onPress={tool.onPress}
              disabled={tool.disabled}
              style={styles.tool}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.sm,
  },
  danger: {
    marginTop: 0,
  },
  tools: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  tool: {
    flexGrow: 1,
    flexBasis: 88,
  },
});
