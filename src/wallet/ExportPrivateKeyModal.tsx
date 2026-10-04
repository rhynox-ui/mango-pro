// src/wallet/ExportPrivateKeyModal.tsx
//
// Sensitive-key export is deliberately gated the same way as the existing
// recovery-phrase reveal: the vault password must unlock the encrypted
// mnemonic, the screen must be protected from screenshots, and raw keys
// are never persisted or sent to the backend.
//
// A seed-phrase wallet derives the account-0 keys locally for the three
// supported native identities. Google/Particle MPC sessions never reach
// this modal because they do not possess exportable raw private keys.

import Clipboard from '@react-native-clipboard/clipboard';
import {useEffect, useMemo, useState} from 'react';
import {Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ErrorText, PasswordField, PrimaryButton} from '../onboarding/ui';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {deriveAccounts, type DerivedAccounts} from './keys';
import {loadVault, unlockVaultMnemonic, VaultLockedError} from './vault';
import {setScreenSecure} from './screenSecurity';

type KeyItem = {
  label: string;
  address: string;
  privateKey: string;
};

export function ExportPrivateKeyModal({visible, onClose}: {visible: boolean; onClose: () => void}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [step, setStep] = useState<'password' | 'keys'>('password');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [accounts, setAccounts] = useState<DerivedAccounts | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
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
    setAccounts(null);
    setRevealed({});
    setCopied(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleUnlock() {
    setChecking(true);
    setError('');
    if (screenSecured !== true) {
      setError("Can't protect this screen from screenshots on this device, so private keys stay hidden.");
      setChecking(false);
      return;
    }
    try {
      const vault = await loadVault();
      if (!vault) throw new Error('No wallet found on this device.');
      const mnemonic = await unlockVaultMnemonic(vault, password);
      const derived = deriveAccounts(mnemonic);
      setAccounts(derived);
      setPassword('');
      setStep('keys');
    } catch (err) {
      setError(err instanceof VaultLockedError ? err.message : 'Incorrect password.');
    } finally {
      setChecking(false);
    }
  }

  const items: KeyItem[] = accounts
    ? [
        {label: 'Ethereum / EVM', address: accounts.evm.address, privateKey: accounts.evm.privateKey},
        {label: 'Solana', address: accounts.solana.address, privateKey: accounts.solana.privateKey},
        ...(accounts.near ? [{label: 'NEAR', address: accounts.near.address, privateKey: accounts.near.privateKey}] : []),
      ]
    : [];

  async function copyKey(item: KeyItem) {
    Clipboard.setString(item.privateKey);
    setCopied(item.label);
    setTimeout(() => setCopied(current => current === item.label ? null : current), 1800);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Export private keys</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={10}>
              <Text style={styles.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          {step === 'password' ? (
            <>
              <Text style={styles.warning}>
                Confirm your wallet password to derive the private keys locally. Mango never uploads these keys.
              </Text>
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
                These keys control the addresses below. Anyone who gets a private key can spend that chain's funds. Do not send keys to anyone or paste them into websites.
              </Text>
              {items.map(item => {
                const isRevealed = revealed[item.label] === true;
                return (
                  <View key={item.label} style={styles.keyCard}>
                    <Text style={styles.keyLabel}>{item.label}</Text>
                    <Text style={styles.address} numberOfLines={1}>{item.address}</Text>
                    <TouchableOpacity
                      style={styles.secretBox}
                      activeOpacity={0.75}
                      onPress={() => setRevealed(prev => ({...prev, [item.label]: !isRevealed}))}
                    >
                      <Text style={styles.secret}>{isRevealed ? item.privateKey : '••••••••••••••••••••••••••••••••'}</Text>
                    </TouchableOpacity>
                    <View style={styles.keyActions}>
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => setRevealed(prev => ({...prev, [item.label]: !isRevealed}))}
                      >
                        <Text style={styles.actionText}>{isRevealed ? 'Hide' : 'Reveal'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionButton} onPress={() => copyKey(item)}>
                        <Text style={styles.actionText}>{copied === item.label ? 'Copied' : 'Copy private key'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
              <View style={styles.buttonWrap}>
                <PrimaryButton onPress={handleClose}>Done</PrimaryButton>
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
    overlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20},
    card: {backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 20, padding: 20, maxHeight: '92%'},
    titleRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12},
    title: {color: colors.textPrimary, fontSize: 18, fontWeight: '800', flexShrink: 1, marginRight: 10},
    closeX: {color: colors.textMuted, fontSize: 16},
    warning: {color: colors.textMuted, fontSize: 12, marginBottom: 12, lineHeight: 17},
    buttonWrap: {marginTop: 14},
    keyCard: {backgroundColor: colors.bg, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8},
    keyLabel: {color: colors.textPrimary, fontSize: 14, fontWeight: '800', marginBottom: 4},
    address: {color: colors.textMuted, fontSize: 10.5, marginBottom: 9},
    secretBox: {backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 10, padding: 10},
    secret: {color: colors.textPrimary, fontSize: 11, fontFamily: 'monospace'},
    keyActions: {flexDirection: 'row', gap: 8, marginTop: 8},
    actionButton: {borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8},
    actionText: {color: colors.textPrimary, fontSize: 12, fontWeight: '700'},
  });
}
