// src/onboarding/SetPasswordStep.tsx
//
// Adapted from mango-mobile's own src/onboarding/SetPasswordStep.tsx —
// same password-policy checklist and busy/error handling, minus the
// referral-code field (no referral system exists in Mango Pro).

import {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {ErrorText, PasswordField, PrimaryButton, RequirementRow, ScreenHeader} from './ui';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {MIN_PASSWORD_LENGTH, checkPasswordPolicy} from '../wallet/passwordPolicy';

export function SetPasswordStep({
  title,
  helpText,
  onSet,
  onBack,
}: {
  title: string;
  helpText: string;
  onSet: (password: string) => Promise<void> | void;
  onBack: () => void;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const {longEnough, notCommon} = checkPasswordPolicy(password);
  const passwordsMatch = password.length > 0 && confirm === password;
  const canSubmit = longEnough && notCommon && passwordsMatch && !busy;

  async function handleSubmit() {
    setBusy(true);
    setError('');
    // Let the busy state actually paint before the PBKDF2-heavy
    // encryptSecret() call below starts.
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      await onSet(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — try again.');
    }
    setBusy(false);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={title} onBack={onBack} />
      <View style={styles.content}>
        <Text style={styles.subtitle}>{helpText}</Text>
        <View style={styles.field}>
          <PasswordField value={password} onChangeText={setPassword} placeholder="Password" autoFocus />
        </View>
        <View style={styles.field}>
          <PasswordField value={confirm} onChangeText={setConfirm} placeholder="Confirm password" />
        </View>
        <View style={styles.checklist}>
          <RequirementRow met={longEnough}>At least {MIN_PASSWORD_LENGTH} characters</RequirementRow>
          <RequirementRow met={notCommon}>Not a commonly used password</RequirementRow>
          <RequirementRow met={passwordsMatch}>Passwords match</RequirementRow>
        </View>
        <ErrorText>{error}</ErrorText>
      </View>
      <View style={styles.footer}>
        {busy && <Text style={styles.busyHint}>Encrypting your wallet on this device — this can take a moment, please don't close the app.</Text>}
        <PrimaryButton onPress={handleSubmit} disabled={!canSubmit} loading={busy}>
          {canSubmit ? 'Set password' : !longEnough ? 'Enter a password' : 'Confirm password to continue'}
        </PrimaryButton>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: {flex: 1},
    content: {flex: 1, paddingHorizontal: 20},
    subtitle: {color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 18},
    field: {marginBottom: 12},
    checklist: {gap: 6, marginTop: 4, marginBottom: 6},
    footer: {padding: 20, gap: 10},
    busyHint: {color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 17},
  });
}
