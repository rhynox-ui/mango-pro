// src/components/TradeResultModal.tsx
//
// A real, can't-miss trade result — matching mango-mobile's own
// SendScreen.tsx pattern (a prominent "Sent 🎉" / "Send failed" state,
// not a small inline line easy to miss), adapted as a Modal instead of
// a full-screen takeover: TokenTradeScreen is a screen people stay on
// to place several trades in a row, unlike Send's one-shot flow that
// navigates away afterward, so this overlays the trade form and
// dismisses back onto it rather than replacing it.
//
// Replaces the old small inline "Trade sent" box AND folds in what the
// top error banner used to show for a completed (not pre-flight) trade
// failure — a finished trade's own result belongs in one clear place,
// not split between a corner box and a banner.

import {useMemo} from 'react';
import {Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {explorerUrlFor} from '../wallet/txHistory';
import type {ChainKey} from '../core/chainData';
import {MangoMark} from './MangoMark';

export type TradeResultSummary = {
  isBuySide: boolean;
  paySymbol: string;
  receiveSymbol: string;
  payAmount: string;
  receivedAmountFormatted: string | null;
  chainKey: ChainKey;
};

export function TradeResultModal({
  visible,
  isSuccess,
  result,
  hashes,
  warnings,
  errorMessage,
  onDone,
}: {
  visible: boolean;
  isSuccess: boolean;
  result: TradeResultSummary | null;
  hashes: string[];
  warnings: string[];
  errorMessage: string | null;
  onDone: () => void;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={[styles.iconCircle, isSuccess ? styles.iconCircleSuccess : styles.iconCircleError]}>
            <MangoMark size={19} color={isSuccess ? colors.gain : colors.danger} />
          </View>
          <Text style={styles.title}>
            {isSuccess && result ? `${result.isBuySide ? 'Bought' : 'Sold'} ${result.isBuySide ? result.receiveSymbol : result.paySymbol}` : isSuccess ? 'Trade sent' : 'Trade failed'}
          </Text>
          {isSuccess && result && (
            <Text style={styles.subtitle}>
              {result.payAmount} {result.paySymbol} → {result.receivedAmountFormatted ?? '?'} {result.receiveSymbol}
            </Text>
          )}
          {!isSuccess && errorMessage && (
            <ScrollView style={styles.errorScroll}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </ScrollView>
          )}
          {isSuccess &&
            hashes.map(hash => {
              const url = result ? explorerUrlFor(result.chainKey, hash) : null;
              return (
                <TouchableOpacity key={hash} disabled={!url} onPress={() => url && Linking.openURL(url)} activeOpacity={0.7}>
                  <Text style={url ? styles.hashLink : styles.hashText} numberOfLines={1} ellipsizeMode="middle">
                    {url ? 'View transaction →' : hash}
                  </Text>
                </TouchableOpacity>
              );
            })}
          {warnings.map(warning => (
            <Text key={warning} style={styles.warningText}>
              {warning}
            </Text>
          ))}
          <TouchableOpacity style={styles.doneButton} onPress={onDone} activeOpacity={0.85}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    overlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 32},
    card: {backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 16, padding: 16, alignItems: 'center'},
    iconCircle: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 10},
    iconCircleSuccess: {backgroundColor: `${colors.gain}22`},
    iconCircleError: {backgroundColor: `${colors.danger}22`},
    title: {color: colors.textPrimary, fontSize: 15, fontWeight: '800', textAlign: 'center'},
    subtitle: {color: colors.textSecondary, fontSize: 12.5, textAlign: 'center', marginTop: 6},
    errorScroll: {maxHeight: 90, marginTop: 6},
    errorText: {color: colors.danger, fontSize: 12.5, textAlign: 'center'},
    hashLink: {color: colors.accent, fontSize: 12, fontWeight: '600', marginTop: 10, textAlign: 'center'},
    hashText: {color: colors.textMuted, fontSize: 11, marginTop: 10, textAlign: 'center'},
    warningText: {color: colors.warning, fontSize: 11, textAlign: 'center', marginTop: 6},
    doneButton: {backgroundColor: colors.ctaBg, borderRadius: 12, paddingVertical: 11, alignItems: 'center', alignSelf: 'stretch', marginTop: 14},
    doneButtonText: {color: colors.ctaText, fontSize: 14, fontWeight: '700'},
  });
}
