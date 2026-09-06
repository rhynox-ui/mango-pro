// src/onboarding/ImportWalletFlow.tsx
//
// Adapted from mango-mobile's own ImportPhraseStep.tsx, combined with
// SetPasswordStep into one two-step flow, same shape as
// CreateWalletFlow.tsx.

import {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {isValidMnemonic, normalizeMnemonic, suggestBip39Words} from '../wallet/keys';
import {currentWordBeingTyped, replaceCurrentWord} from './phraseInput';
import {AppTextInput, ErrorText, PrimaryButton, ScreenHeader} from './ui';
import {SetPasswordStep} from './SetPasswordStep';
import {WordSuggestionRow} from './WordSuggestionRow';
import {useTheme, type Colors} from '../theme/ThemeContext';

export function ImportWalletFlow({onFinish, onCancel}: {onFinish: (mnemonic: string, password: string) => Promise<void>; onCancel: () => void}) {
  const [step, setStep] = useState<{name: 'phrase'} | {name: 'password'; mnemonic: string}>({name: 'phrase'});

  if (step.name === 'password') {
    return (
      <SetPasswordStep
        title="Set a password"
        helpText="This password encrypts your wallet on this device. Mango never sees it and can't reset it for you."
        onBack={() => setStep({name: 'phrase'})}
        onSet={password => onFinish(step.mnemonic, password)}
      />
    );
  }

  return <PhraseStep onImported={mnemonic => setStep({name: 'password', mnemonic})} onBack={onCancel} />;
}

function PhraseStep({onImported, onBack}: {onImported: (mnemonic: string) => void; onBack: () => void}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');

  const wordCount = phrase.trim() ? phrase.trim().split(/\s+/).length : 0;
  const suggestions = suggestBip39Words(currentWordBeingTyped(phrase), 5);

  function handleContinue() {
    if (!isValidMnemonic(phrase)) {
      setError('That recovery phrase is invalid — check the word order and spelling.');
      return;
    }
    setError('');
    onImported(normalizeMnemonic(phrase));
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Import wallet" onBack={onBack} />
      <View style={styles.content}>
        <Text style={styles.subtitle}>Enter your 12 or 24-word recovery phrase, separated by spaces.</Text>
        <AppTextInput
          value={phrase}
          onChangeText={t => {
            setPhrase(t);
            setError('');
          }}
          placeholder="word1 word2 word3 ..."
          multiline
          numberOfLines={4}
          style={styles.textarea}
        />
        <View style={styles.metaRow}>
          <Text style={styles.wordCount}>{wordCount > 0 ? `${wordCount} words` : ' '}</Text>
        </View>
        <WordSuggestionRow suggestions={suggestions} onPick={word => setPhrase(prev => replaceCurrentWord(prev, word))} />
        <ErrorText>{error}</ErrorText>
      </View>
      <View style={styles.footer}>
        <PrimaryButton onPress={handleContinue} disabled={wordCount < 12}>
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
    subtitle: {color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16},
    textarea: {minHeight: 100, textAlignVertical: 'top'},
    metaRow: {alignItems: 'flex-end', marginTop: 6},
    wordCount: {color: colors.textMuted, fontSize: 11.5},
    footer: {padding: 20},
  });
}
