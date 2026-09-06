// src/onboarding/CreateWalletFlow.tsx
//
// Adapted from mango-mobile's own CreateRevealStep.tsx, combined with
// SetPasswordStep into one two-step flow component. The mnemonic is
// generated once, on mount, and held only in this component's state —
// never persisted until SetPasswordStep's onFinish successfully
// encrypts and saves it.
//
// Deliberately drops mobile's separate CreateConfirmStep.tsx (retype
// three random words from the phrase) — a real UX safety net, but not a
// correctness requirement, and a reasonable v1 scope cut. The checkbox
// gate here ("I've saved my recovery phrase") is the same one mobile's
// own CreateRevealStep already uses before that stronger check; adding
// the retype quiz is a good follow-up, not a security gap as-is.

import {useMemo, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {PrimaryButton, ScreenHeader} from './ui';
import {SetPasswordStep} from './SetPasswordStep';
import {generateMnemonic} from '../wallet/keys';
import {useTheme, type Colors} from '../theme/ThemeContext';

export function CreateWalletFlow({onFinish, onCancel}: {onFinish: (mnemonic: string, password: string) => Promise<void>; onCancel: () => void}) {
  const [step, setStep] = useState<'reveal' | 'password'>('reveal');
  const [mnemonic] = useState(() => generateMnemonic());

  if (step === 'password') {
    return (
      <SetPasswordStep
        title="Set a password"
        helpText="This password encrypts your wallet on this device. Mango never sees it and can't reset it for you."
        onBack={() => setStep('reveal')}
        onSet={password => onFinish(mnemonic, password)}
      />
    );
  }

  return <RevealStep mnemonic={mnemonic} onNext={() => setStep('password')} onBack={onCancel} />;
}

function RevealStep({mnemonic, onNext, onBack}: {mnemonic: string; onNext: () => void; onBack: () => void}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [revealed, setRevealed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const words = mnemonic.split(' ');

  return (
    <View style={styles.container}>
      <ScreenHeader title="Recovery phrase" onBack={onBack} />
      <View style={styles.content}>
        <Text style={styles.warning}>
          Write these 12 words down in order and keep them somewhere safe. Anyone with this phrase can take everything in this wallet — Mango cannot recover it for you if it's lost.
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

        <TouchableOpacity style={styles.checkboxRow} onPress={() => setConfirmed(c => !c)} activeOpacity={0.7} disabled={!revealed}>
          <View style={[styles.checkbox, confirmed && styles.checkboxChecked, !revealed && styles.checkboxDisabled]}>
            {confirmed && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkboxLabel}>I've saved my recovery phrase somewhere safe</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.footer}>
        <PrimaryButton onPress={onNext} disabled={!confirmed}>
          Continue
        </PrimaryButton>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: {flex: 1},
    content: {flex: 1, paddingHorizontal: 20},
    warning: {color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16},
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      backgroundColor: colors.panel,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderRadius: 18,
      padding: 12,
      position: 'relative',
      overflow: 'hidden',
    },
    wordCell: {width: '50%', flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6},
    wordIndex: {color: colors.textMuted, fontSize: 12, width: 20},
    wordText: {color: colors.textPrimary, fontSize: 14, fontWeight: '600'},
    revealOverlay: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,11,0.55)', alignItems: 'center', justifyContent: 'center'},
    revealText: {color: '#F5F5F6', fontSize: 13.5, fontWeight: '700'},
    checkboxRow: {flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 10},
    checkbox: {width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: colors.panelBorder, alignItems: 'center', justifyContent: 'center'},
    checkboxChecked: {backgroundColor: colors.accent, borderColor: colors.accent},
    checkboxDisabled: {opacity: 0.4},
    checkmark: {color: colors.bg, fontSize: 12, fontWeight: '900'},
    checkboxLabel: {color: colors.textSecondary, fontSize: 13, flex: 1},
    footer: {padding: 20},
  });
}
