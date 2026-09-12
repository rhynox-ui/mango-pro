// src/onboarding/LockedScreen.tsx
//
// Adapted from mango-mobile's own LockedScreen.tsx — same lockout
// throttling (unlockAttempts.ts) and busy-state handling. Biometric
// unlock (react-native-keychain) is now wired in too, same as mobile's
// own version — see biometricAuth.ts for the real storage/gating
// mechanics. Also same MANGO_MARK require()+Image pattern mobile's own
// LockedScreen uses.

import {useEffect, useMemo, useRef, useState} from 'react';
import {Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ErrorText, PasswordField, PrimaryButton} from './ui';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {getLockoutStatus} from '../wallet/unlockAttempts';
import {VaultLockedError} from '../wallet/vault';

const MANGO_MARK = require('../assets/mango-mark.png');

function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.ceil(totalSeconds / 60)}m`;
}

export function LockedScreen({
  onUnlock,
  biometricEnabled,
  biometryLabel,
  onBiometricUnlock,
}: {
  onUnlock: (password: string) => Promise<void> | void;
  biometricEnabled?: boolean;
  biometryLabel?: string;
  onBiometricUnlock?: () => Promise<void> | void;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [error, setError] = useState('');
  const [lockoutMs, setLockoutMs] = useState(0);
  const lockoutInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getLockoutStatus().then(status => {
      if (status.locked) setLockoutMs(status.remainingMs);
    });
  }, []);

  useEffect(() => {
    if (lockoutMs <= 0) {
      if (lockoutInterval.current) {
        clearInterval(lockoutInterval.current);
        lockoutInterval.current = null;
      }
      return;
    }
    lockoutInterval.current = setInterval(() => {
      setLockoutMs(ms => Math.max(0, ms - 1000));
    }, 1000);
    return () => {
      if (lockoutInterval.current) clearInterval(lockoutInterval.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockoutMs > 0]);

  async function handleUnlock() {
    setBusy(true);
    setError('');
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      // Lockout is enforced inside unlockVaultMnemonic itself now (a
      // security audit flagged this screen as the ONLY place the
      // throttle was ever applied — see vault.ts's own header) — this
      // screen just reacts to VaultLockedError for the countdown UI
      // rather than tracking attempts itself.
      await onUnlock(password);
    } catch (err) {
      if (err instanceof VaultLockedError) {
        setLockoutMs(err.remainingMs);
        setError('Too many incorrect attempts.');
      } else {
        setError(err instanceof Error ? err.message : 'Incorrect password.');
      }
    }
    setBusy(false);
  }

  async function handleBiometricPress() {
    if (!onBiometricUnlock) return;
    setBiometricBusy(true);
    setError('');
    try {
      await onBiometricUnlock();
    } catch (err) {
      if (err instanceof VaultLockedError) {
        setLockoutMs(err.remainingMs);
        setError('Too many incorrect attempts.');
      } else {
        setError(err instanceof Error ? err.message : 'Biometric unlock failed — try your password.');
      }
    }
    setBiometricBusy(false);
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Image source={MANGO_MARK} style={styles.logoImage} resizeMode="contain" />
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Enter your password to unlock.</Text>
        <View style={styles.field}>
          <PasswordField value={password} onChangeText={setPassword} placeholder="Password" autoFocus />
        </View>
        <ErrorText>{error}</ErrorText>
        {lockoutMs > 0 && <Text style={styles.lockoutText}>Too many incorrect attempts — try again in {formatCountdown(lockoutMs)}.</Text>}
        <View style={styles.buttonWrap}>
          {busy && <Text style={styles.busyHint}>Unlocking — this can take a moment on some devices.</Text>}
          <PrimaryButton onPress={handleUnlock} disabled={!password || busy || biometricBusy || lockoutMs > 0} loading={busy}>
            Unlock
          </PrimaryButton>
          {biometricEnabled && (
            <TouchableOpacity onPress={handleBiometricPress} disabled={busy || biometricBusy} style={styles.biometricLink} hitSlop={8}>
              <Text style={styles.biometricLinkText}>{biometricBusy ? 'Waiting…' : `Unlock with ${biometryLabel ?? 'biometric'}`}</Text>
            </TouchableOpacity>
          )}
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
    field: {width: '100%', marginBottom: 4},
    buttonWrap: {width: '100%', marginTop: 12, gap: 10},
    busyHint: {color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 17},
    lockoutText: {color: colors.danger, fontSize: 12, textAlign: 'center', lineHeight: 17, marginTop: 4},
    biometricLink: {alignItems: 'center', paddingVertical: 6},
    biometricLinkText: {color: colors.textPrimary, fontSize: 13, fontWeight: '600'},
  });
}
