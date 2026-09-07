// src/onboarding/AppLockScreen.tsx
//
// The Google/Particle-session equivalent of LockedScreen.tsx — same
// card layout and brand mark, but no password field at all, since a
// Google session has no local password to type (see appLockAuth.ts's
// own header for why this exists as a separate mechanism). Auto-prompts
// biometrics on mount so the common case (device biometrics already
// enrolled) needs zero taps beyond returning to the app; "Log out
// instead" is the honest fallback for a cancelled/failed/unavailable
// prompt, matching appLockAuth.ts's own authenticationPrompt.cancel copy.

import {useEffect, useRef, useState} from 'react';
import {Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ErrorText, PrimaryButton} from './ui';
import {useTheme, type Colors} from '../theme/ThemeContext';

const MANGO_MARK = require('../assets/mango-mark.png');

export function AppLockScreen({
  onUnlock,
  onLogout,
  biometryLabel,
}: {
  onUnlock: () => Promise<boolean>;
  onLogout: () => void;
  biometryLabel: string;
}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const autoPrompted = useRef(false);

  async function attemptUnlock() {
    setBusy(true);
    setError('');
    const ok = await onUnlock();
    if (!ok) {
      setError(`Couldn't verify with ${biometryLabel}.`);
    }
    setBusy(false);
  }

  useEffect(() => {
    if (autoPrompted.current) return;
    autoPrompted.current = true;
    attemptUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Image source={MANGO_MARK} style={styles.logoImage} resizeMode="contain" />
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Use {biometryLabel} to continue.</Text>
        <ErrorText>{error}</ErrorText>
        <View style={styles.buttonWrap}>
          <PrimaryButton onPress={attemptUnlock} disabled={busy} loading={busy}>
            {`Unlock with ${biometryLabel}`}
          </PrimaryButton>
          <TouchableOpacity onPress={onLogout} disabled={busy} style={styles.logoutLink} hitSlop={8}>
            <Text style={styles.logoutLinkText}>Log out instead</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg},
    card: {width: '100%', maxWidth: 380, backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 24, padding: 24, alignItems: 'center'},
    logoImage: {width: 56, height: 56, marginBottom: 16},
    title: {color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6},
    subtitle: {color: colors.textSecondary, fontSize: 13, marginBottom: 20},
    buttonWrap: {width: '100%', marginTop: 12, gap: 10},
    logoutLink: {alignItems: 'center', paddingVertical: 6},
    logoutLinkText: {color: colors.textSecondary, fontSize: 13, fontWeight: '600'},
  });
}
