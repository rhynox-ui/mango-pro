// src/wallet/RevealPhraseModal.tsx
//
// Real gap this closes: CreateWalletFlow.tsx's own RevealStep shows the
// recovery phrase exactly once, at wallet creation — there was no way
// afterward to re-view an EXISTING wallet's own phrase anywhere in the
// app. A user who mistyped or lost their one-time backup had no way to
// re-check it against what they wrote down, or to correctly copy it
// into another wallet (MetaMask, Phantom, etc.) later — a real, live
// path to "this phrase doesn't work outside Mango" that has nothing to
// do with the derivation math itself (verified byte-identical to
// independent implementations — see scripts/verify-wallet-crypto.mjs).
//
// Same re-authentication pattern as EnableBiometricModal.tsx: the raw
// mnemonic is never kept in memory as part of the session (App.tsx
// discards it right after deriveAccounts() at unlock), so revealing it
// again means a fresh loadVault() + unlockVaultMnemonic(vault, password)
// call here, gated behind the same password-throttled unlock every
// other vault access already goes through.

import Clipboard from '@react-native-clipboard/clipboard';
import {useEffect, useMemo, useState} from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ErrorText, PasswordField, PrimaryButton} from '../onboarding/ui';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {loadVault, unlockVaultMnemonic, VaultLockedError} from './vault';
import {setScreenSecure} from './screenSecurity';

export function RevealPhraseModal({visible, onClose}: {visible: boolean; onClose: () => void}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [step, setStep] = useState<'password' | 'phrase'>('password');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [mnemonic, setMnemonic] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fails closed: the phrase is only ever unlocked once FLAG_SECURE is
  // genuinely applied, same contract mango-mobile's own RevealSeedPhraseModal.tsx
  // holds to — a screenshot of a recovery phrase is a direct, permanent
  // path to draining the wallet. null means "not determined yet", which
  // reads as not-yet-secured.
  const [screenSecured, setScreenSecured] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!visible) {
      setScreenSecured(null);
      return;
    }
    setScreenSecure(true).then(ok => {
      if (!cancelled) setScreenSecured(ok);
    });
    return () => {
      cancelled = true;
      setScreenSecure(false);
    };
  }, [visible]);

  function reset() {
    setStep('password');
    setPassword('');
    setError('');
    setChecking(false);
    setMnemonic('');
    setRevealed(false);
    setCopied(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleUnlock() {
    setChecking(true);
    setError('');
    if (screenSecured !== true) {
      setError("Can't protect this screen from screenshots on this device, so the phrase stays hidden. Close and reopen; if it keeps happening, reinstall the app rather than working around it.");
      setChecking(false);
      return;
    }
    try {
      const vault = await loadVault();
      if (!vault) throw new Error('No wallet found on this device.');
      const phrase = await unlockVaultMnemonic(vault, password);
      setMnemonic(phrase);
      setPassword('');
      setStep('phrase');
    } catch (err) {
      setError(err instanceof VaultLockedError ? err.message : 'Incorrect password.');
    } finally {
      setChecking(false);
    }
  }

  const words = mnemonic ? mnemonic.split(' ') : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Recovery phrase</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={10}>
              <Text style={styles.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          {step === 'password' ? (
            <>
              <Text style={styles.warning}>Confirm your password to view this wallet's recovery phrase.</Text>
              <PasswordField value={password} onChangeText={setPassword} placeholder="Password" autoFocus />
              <ErrorText>{error}</ErrorText>
              <View style={styles.buttonWrap}>
                <PrimaryButton onPress={handleUnlock} disabled={!password} loading={checking}>
                  Continue
                </PrimaryButton>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.warning}>
                Anyone with these words can take everything in this wallet. The exact words and order below are what any other wallet (MetaMask, Phantom, etc.) needs to import this same wallet.
              </Text>
              <TouchableOpacity style={styles.grid} activeOpacity={revealed ? 1 : 0.7} onPress={() => setRevealed(true)}>
                {words.map((word, i) => (
                  <View key={i} style={styles.wordCell}>
                    <Text style={styles.wordIndex}>{i + 1}</Text>
                    <Text style={styles.wordText}>{revealed ? word : '••••••'}</Text>
                  </View>
                ))}
                {!revealed && (
                  <View style={styles.revealOverlay}>
                    <Text style={styles.revealText}>Tap to reveal</Text>
                  </View>
                )}
              </TouchableOpacity>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    Clipboard.setString(mnemonic);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  <Text style={styles.secondaryButtonText}>{copied ? 'Copied' : 'Copy recovery phrase'}</Text>
                </TouchableOpacity>
                <View style={styles.doneButton}>
                  <PrimaryButton onPress={handleClose}>Done</PrimaryButton>
                </View>
              </View>
            </>
          )}
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
    actionRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14},
    doneButton: {flex: 1},
    secondaryButton: {flex: 1, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center'},
    secondaryButtonText: {color: colors.textPrimary, fontSize: 12, fontWeight: '700'},
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      backgroundColor: colors.bg,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderRadius: 14,
      padding: 10,
      position: 'relative',
      overflow: 'hidden',
    },
    wordCell: {width: '50%', flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 6},
    wordIndex: {color: colors.textMuted, fontSize: 11, width: 18},
    wordText: {color: colors.textPrimary, fontSize: 13.5, fontWeight: '600'},
    revealOverlay: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,11,0.55)', alignItems: 'center', justifyContent: 'center'},
    revealText: {color: '#F5F5F6', fontSize: 13, fontWeight: '700'},
  });
}
