// src/onboarding/ui.tsx
//
// Ported directly from mango-mobile's own src/onboarding/ui.tsx — shared
// visual primitives for the onboarding flow (welcome, create, confirm,
// password, import, lock), all theme-aware via useTheme() so flipping
// light/dark re-renders these immediately. Dropped mobile's `COLORS`
// backward-compat alias (nothing here predates useTheme(), so there's
// nothing for it to support).

import React, {useMemo, useRef} from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {useTheme, type Colors} from '../theme/ThemeContext';

// Same Eye/EyeOff glyphs (lucide) mobile's own PasswordField uses.
// `visible` names the ACTION the icon represents (tap to reveal/tap to
// hide): when the password is currently shown, the crossed-eye (EyeOff)
// icon is what invites hiding it again.
function EyeToggleIcon({visible, color, size = 16}: {visible: boolean; color: string; size?: number}) {
  const common = {viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
  if (visible) {
    return (
      <Svg width={size} height={size} {...common}>
        <Path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
        <Path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
        <Path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
        <Path d="m2 2 20 20" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} {...common}>
      <Path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <Circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function ScreenHeader({title, onBack}: {title: string; onBack?: () => void}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.backButton} />
      )}
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.backButton} />
    </View>
  );
}

export function PrimaryButton({
  children,
  onPress,
  disabled,
  loading,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scale = useRef(new Animated.Value(1)).current;
  function handlePressIn() {
    Animated.timing(scale, {toValue: 0.97, duration: 80, useNativeDriver: true}).start();
  }
  function handlePressOut() {
    Animated.spring(scale, {toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6}).start();
  }
  return (
    <TouchableOpacity onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut} disabled={disabled || loading} activeOpacity={0.85}>
      <Animated.View style={[styles.primaryButton, disabled && styles.buttonDisabled, {transform: [{scale}]}]}>
        {loading ? <ActivityIndicator color={colors.bg} /> : <Text style={[styles.primaryButtonText, disabled && styles.buttonTextDisabled]}>{children}</Text>}
      </Animated.View>
    </TouchableOpacity>
  );
}

export function SecondaryButton({children, onPress, danger}: {children: string; onPress: () => void; danger?: boolean}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity style={styles.secondaryButton} onPress={onPress} activeOpacity={0.85}>
      <Text style={[styles.secondaryButtonText, danger && {color: colors.danger}]}>{children}</Text>
    </TouchableOpacity>
  );
}

export function AppTextInput(props: TextInputProps) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      // Onboarding fields (password, recovery phrase) must never be
      // filled by the OS's autofill/SMS-OTP suggestion strip — besides
      // the secrecy concern, that native injection path is a known
      // source of controlled TextInputs going out of sync with React
      // state (the field shows the suggested text but onChangeText never
      // fires), which looks exactly like a stuck submit button.
      autoComplete="off"
      importantForAutofill="no"
      textContentType="none"
      {...props}
      style={[styles.textInput, props.style]}
    />
  );
}

export function PasswordField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [visible, setVisible] = React.useState(false);
  return (
    <View style={styles.passwordWrap}>
      <AppTextInput value={value} onChangeText={onChangeText} placeholder={placeholder} secureTextEntry={!visible} autoFocus={autoFocus} style={styles.passwordInput} />
      <TouchableOpacity onPress={() => setVisible(v => !v)} style={styles.eyeButton} hitSlop={10}>
        <EyeToggleIcon visible={visible} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

/** A single live-updating password requirement — visible before typing starts, flips to a checkmark the moment it's satisfied. */
export function RequirementRow({met, children}: {met: boolean; children: React.ReactNode}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.requirementRow}>
      <Text style={[styles.requirementMark, met && styles.requirementMarkMet]}>{met ? '✓' : '○'}</Text>
      <Text style={[styles.requirementText, met && styles.requirementTextMet]}>{children}</Text>
    </View>
  );
}

export function ErrorText({children}: {children: React.ReactNode}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!children) return null;
  return <Text style={styles.errorText}>{children}</Text>;
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 14},
    backButton: {width: 36, height: 36, alignItems: 'center', justifyContent: 'center'},
    backChevron: {color: colors.textPrimary, fontSize: 26, fontWeight: '600', marginTop: -2},
    headerTitle: {color: colors.textPrimary, fontSize: 15, fontWeight: '700'},
    primaryButton: {width: '100%', backgroundColor: colors.textPrimary, borderRadius: 999, paddingVertical: 15, alignItems: 'center'},
    // Deliberately pillBg/textSecondary rather than panelBorder+opacity —
    // mobile's own device testing found the latter measured ~1.9:1
    // contrast (functionally invisible); this combination clears WCAG
    // AA's 4.5:1 in both themes.
    buttonDisabled: {backgroundColor: colors.pillBg},
    primaryButtonText: {color: colors.bg, fontSize: 14.5, fontWeight: '700'},
    buttonTextDisabled: {color: colors.textSecondary},
    secondaryButton: {width: '100%', backgroundColor: colors.pillBg, borderRadius: 999, paddingVertical: 15, alignItems: 'center'},
    secondaryButtonText: {color: colors.textPrimary, fontSize: 14.5, fontWeight: '600'},
    textInput: {
      width: '100%',
      backgroundColor: colors.input,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 13,
      color: colors.textPrimary,
      fontSize: 14.5,
    },
    passwordWrap: {position: 'relative', justifyContent: 'center'},
    passwordInput: {paddingRight: 60},
    eyeButton: {position: 'absolute', top: 0, bottom: 0, right: 14, justifyContent: 'center'},
    errorText: {color: colors.danger, fontSize: 12, marginTop: -4},
    requirementRow: {flexDirection: 'row', alignItems: 'center', gap: 7},
    requirementMark: {color: colors.textSecondary, fontSize: 12, width: 14},
    requirementMarkMet: {color: colors.accent, fontWeight: '700'},
    requirementText: {color: colors.textSecondary, fontSize: 12},
    requirementTextMet: {color: colors.textPrimary},
  });
}
