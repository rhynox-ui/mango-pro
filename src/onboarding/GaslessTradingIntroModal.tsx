// src/onboarding/GaslessTradingIntroModal.tsx
//
// Shown once, immediately after a seed wallet is created or imported
// (App.tsx's finishOnboarding) — before the user ever reaches a trade
// screen. This app's whole premise is not needing native gas to trade
// (ARCHITECTURE.md §1), so a user shouldn't be able to fund the wallet
// and land on Trade before ever learning that. Gasless trading is
// already ON by default at this point (gaslessTradingPrefs.ts) — this
// is a one-tap acknowledgement, not a choice to opt in, matching the
// same "shown once right after onboarding" pattern as
// RecommendBiometricModal, but with a single dismiss instead of a
// toggle, since there's nothing to opt into here.
//
// Skipped entirely for a Google/Particle session (App.tsx never shows
// it there): Relay handles the gasless execution path directly
// with, so there's nothing true to tell that user yet.

import {useMemo} from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useTheme, type Colors} from '../theme/ThemeContext';

export function GaslessTradingIntroModal({visible, onDone}: {visible: boolean; onDone: () => void}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Gasless trading is on</Text>
          <Text style={styles.body}>
            Mango Pro covers your network fees on trades, so you can trade with just the token balance you're spending — no
            ETH, BNB, or other native gas needed on top of it. You can turn this off later in Security if you'd rather use
            your own gas.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onDone} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>Got it</Text>
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
    title: {color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 10},
    body: {color: colors.textSecondary, fontSize: 13.5, lineHeight: 19, marginBottom: 18},
    primaryButton: {backgroundColor: colors.ctaBg, borderRadius: 14, paddingVertical: 13, alignItems: 'center'},
    primaryButtonText: {color: colors.ctaText, fontSize: 15, fontWeight: '700'},
  });
}
