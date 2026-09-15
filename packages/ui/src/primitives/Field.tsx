import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, space, fontFamilies } from '../theme';
import { AppText } from './AppText';

type FieldProps = TextInputProps & {
  label: string;
  error?: string | null;
  helper?: string | null;
};

export function Field({
  label,
  error,
  helper,
  style,
  onFocus,
  onBlur,
  secureTextEntry,
  ...rest
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.wrap}>
      <AppText preset="meta" style={styles.label}>
        {label}
      </AppText>
      <View>
        <TextInput
          {...rest}
          secureTextEntry={secureTextEntry && !revealed}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          /**
           * Hata ve yardım metni alanın KENDİSİNE bağlanır. Ayrı bir metin
           * satırı olarak bırakıldığında ekran okuyucu alana odaklandığında
           * hatayı hiç söylemiyor, kullanıcı neyin yanlış olduğunu bilmeden
           * aynı değeri tekrar gönderiyordu.
           */
          accessibilityHint={error ?? helper ?? rest.accessibilityHint}
          aria-invalid={Boolean(error)}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          selectionColor={colors.rail}
          placeholderTextColor={colors.mute}
          style={[
            styles.input,
            secureTextEntry && styles.secretInput,
            focused && styles.inputFocused,
            rest.editable === false && styles.inputDisabled,
            error ? styles.inputError : null,
            style,
          ]}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Parolayı gizle' : 'Parolayı göster'}
            onPress={() => setRevealed((value) => !value)}
            style={styles.reveal}
          >
            <AppText preset="caption" color={colors.rail}>
              {revealed ? 'Gizle' : 'Göster'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText
          preset="caption"
          color={colors.danger}
          style={styles.hint}
          accessibilityLiveRegion="polite"
          role="alert"
        >
          {error}
        </AppText>
      ) : helper ? (
        <AppText preset="caption" style={styles.hint}>
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: space.md,
  },
  label: {
    marginBottom: space.xs,
    color: colors.ink,
  },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.field,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: colors.ink,
    fontFamily: fontFamilies.uiRegular,
    fontSize: 16,
  },
  inputFocused: { borderColor: colors.rail, backgroundColor: '#FCFDFB' },
  secretInput: { paddingRight: 76 },
  reveal: {
    position: 'absolute',
    right: 4,
    top: 4,
    bottom: 4,
    minWidth: 64,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputDisabled: { backgroundColor: colors.mist, color: colors.mute },
  inputError: {
    borderColor: colors.danger,
  },
  hint: {
    marginTop: space.xxs,
  },
});
