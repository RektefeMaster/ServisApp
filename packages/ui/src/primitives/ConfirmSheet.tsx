import { StyleSheet, View } from 'react-native';
import { space } from '../theme';
import { AppText } from './AppText';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';

type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Vazgeç',
  danger = true,
  busy,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  return (
    <BottomSheet visible={visible} level="action" title={title} onClose={onCancel}>
      <AppText preset="body" style={styles.body}>
        {body}
      </AppText>
      <View style={styles.actions}>
        <Button
          label={confirmLabel}
          onPress={onConfirm}
          variant={danger ? 'danger' : 'primary'}
          size="crewPrimary"
          loading={busy}
          disabled={busy}
        />
        <Button label={cancelLabel} onPress={onCancel} variant="ghost" disabled={busy} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    marginBottom: space.lg,
  },
  actions: {
    gap: space.sm,
  },
});
