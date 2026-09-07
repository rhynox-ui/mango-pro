// src/wallet/EnableBiometricModal.tsx
//
// Ported from mango-mobile's own file of the same name (adapted to this
// app's own, simpler single-wallet vault.ts shape — loadVault() +
// unlockVaultMnemonic(vault, password) here, rather than mobile's
// per-wallet wallets[0].mnemonicRecord + decryptSecret()). Same real
// reason it exists: biometricAuth.ts's own enableBiometricUnlock never
// itself checks a password — this modal is what actually verifies it
// (by attempting a real vault unlock) before storing anything in the
// device's secure hardware.

import {useMemo, useState} from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ErrorText, PasswordField, PrimaryButton} from '../onboarding/ui';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {loadVault, unlockVaultMnemonic} from './vault';
import {enableBiometricUnlock} from './biometricAuth';

export function EnableBiometricModal({
  visible,
  biometryLabel,
  onClose,
  onEnabled,
}: {
  visible: boolean;
  biometryLabel: string;
  onClose: () => void;
  onEnabled: () => void;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  function reset() {
    setPassword('');
    setError('');
    setChecking(false);
  }

  async function handleEnable() {
    setChecking(true);
    setError('');
    try {
      const vault = await loadVault();
      if (!vault) {
        throw new Error('No wallet found on this device.');
      }
      await unlockVaultMnemonic(vault, password);
      await enableBiometricUnlock(password);
      reset();
      onEnabled();
    } catch {
      setError('Incorrect password.');
      setChecking(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        reset();
        onClose();
      }}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Enable {biometryLabel} unlock</Text>
            <TouchableOpacity
              onPress={() => {
                reset();
                onClose();
              }}
              hitSlop={10}>
              <Text style={styles.closeX}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.warning}>
            Confirm your password once to enable {biometryLabel} unlock. Your password is stored only in this device's secure hardware, gated behind biometric authentication — it never leaves
            this device.
          </Text>
          <PasswordField value={password} onChangeText={setPassword} placeholder="Password" autoFocus />
          <ErrorText>{error}</ErrorText>
          <View style={styles.buttonWrap}>
            <PrimaryButton onPress={handleEnable} disabled={!password} loading={checking}>
              Enable
            </PrimaryButton>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    overlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24},
    card: {backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 20, padding: 20},
    titleRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12},
    title: {color: colors.textPrimary, fontSize: 16, fontWeight: '700', flexShrink: 1, marginRight: 10},
    closeX: {color: colors.textMuted, fontSize: 16},
    warning: {color: colors.textMuted, fontSize: 12, marginBottom: 12, lineHeight: 17},
    buttonWrap: {marginTop: 14},
  });
}
