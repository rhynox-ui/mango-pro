// src/wallet/RecommendBiometricModal.tsx
//
// Ported from mango-mobile's own file of the same name — shown once,
// immediately after a user's first successful password setup (App.tsx's
// finishOnboarding, whether that's Create or Import), offering to gate
// the wallet behind whatever the phone already uses to unlock
// (fingerprint, face, PIN, or pattern — see biometricAuth.ts). The
// password was just typed and confirmed a few seconds ago, so unlike
// EnableBiometricModal (used later from Settings, where the password
// isn't already in memory) this never re-prompts for it — enabling is a
// single tap.

import {useMemo, useState} from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {enableBiometricUnlock} from './biometricAuth';

export function RecommendBiometricModal({
  visible,
  biometryLabel,
  password,
  onDone,
}: {
  visible: boolean;
  biometryLabel: string;
  password: string;
  onDone: (enabled: boolean) => void;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);

  async function handleEnable() {
    setBusy(true);
    const ok = await enableBiometricUnlock(password).catch(() => false);
    setBusy(false);
    onDone(ok);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onDone(false)}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Use {biometryLabel} to unlock?</Text>
          <TouchableOpacity style={[styles.primaryButton, busy && styles.buttonDisabled]} onPress={handleEnable} disabled={busy} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>{busy ? 'Enabling…' : `Enable ${biometryLabel}`}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => onDone(false)} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    overlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24},
    card: {backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 20, padding: 20},
    title: {color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 18},
    primaryButton: {backgroundColor: colors.ctaBg, borderRadius: 14, paddingVertical: 13, alignItems: 'center'},
    buttonDisabled: {opacity: 0.6},
    primaryButtonText: {color: colors.ctaText, fontSize: 15, fontWeight: '700'},
    secondaryButton: {paddingVertical: 12, alignItems: 'center'},
    secondaryButtonText: {color: colors.textSecondary, fontSize: 13.5, fontWeight: '600'},
  });
}
