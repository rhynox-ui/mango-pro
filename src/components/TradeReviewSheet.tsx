// src/components/TradeReviewSheet.tsx
//
// The review step before a trade is signed (an uploaded audit's H-02,
// verified: tapping Buy/Sell used to sign straight away). Built on the
// app's own BottomSheet with TradeSettingsSheet's styling, so it's the
// same sheet the user already knows. It shows exactly what the trade
// screen is about to execute — the same quote state handleTrade uses —
// and nothing is signed until Confirm. The pre-sign firewalls
// (txIntentFirewall, fallbackTxFirewall, solanaSpendGuard, the NEAR
// route checks) still bind what's signed to these same amounts.

import React, {useMemo} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {BottomSheet} from './BottomSheet';
import type {QuoteSummary} from '../core/relayQuote';

export type TradeReview = {
  isBuySide: boolean;
  payAmount: string;
  paySymbol: string;
  receiveSymbol: string;
  quote: QuoteSummary | null;
  networkLabel: string;
  routeLabel: string;
  slippageLabel: string;
  networkFeeNote: string;
  feeFallbackLabel: string;
};

export function TradeReviewSheet({visible, onClose, onConfirm, review}: {visible: boolean; onClose: () => void; onConfirm: () => void; review: TradeReview}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {isBuySide, payAmount, paySymbol, receiveSymbol, quote} = review;
  const impact = quote?.priceImpactPct != null ? Math.abs(quote.priceImpactPct) : null;

  const rows: {label: string; value: string; danger?: boolean}[] = [
    {label: 'You pay', value: `${payAmount} ${paySymbol}${quote?.payAmountUsd != null ? `  (≈ $${quote.payAmountUsd.toFixed(2)})` : ''}`},
    {label: 'You receive (estimated)', value: `${quote?.receivedAmountFormatted ?? '—'} ${receiveSymbol}`},
    {label: 'Minimum received', value: quote?.minReceivedFormatted ? `${quote.minReceivedFormatted} ${receiveSymbol}` : '—'},
    {label: 'Fees', value: quote?.totalFeeUsd != null ? `$${quote.totalFeeUsd.toFixed(2)}` : review.feeFallbackLabel},
    ...(impact != null ? [{label: 'Price impact', value: `${impact.toFixed(2)}%`, danger: impact > 3}] : []),
    {label: 'Network', value: review.networkLabel},
    {label: 'Route', value: review.routeLabel},
    {label: 'Slippage', value: review.slippageLabel},
    {label: 'Goes to', value: 'Your wallet'},
    {label: 'Network fees', value: review.networkFeeNote},
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{isBuySide ? `Review buy` : `Review sell`}</Text>
      </View>
      <View style={styles.rows}>
        {rows.map(row => (
          <View key={row.label} style={styles.row}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Text style={[styles.rowValue, row.danger && styles.rowValueDanger]} numberOfLines={2}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
      {impact != null && impact > 3 && <Text style={styles.warningText}>High price impact — you may receive noticeably less than the market price.</Text>}
      <TouchableOpacity style={[styles.confirmButton, isBuySide ? styles.confirmBuy : styles.confirmSell]} onPress={onConfirm} activeOpacity={0.85}>
        <Text style={styles.confirmButtonText}>{isBuySide ? 'Confirm buy' : 'Confirm sell'}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Nothing is signed until you confirm. Swipe down to cancel.</Text>
    </BottomSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14},
    title: {color: colors.textPrimary, fontSize: 17, fontWeight: '800'},
    rows: {gap: 10, marginBottom: 14},
    row: {flexDirection: 'row', justifyContent: 'space-between', gap: 12},
    rowLabel: {color: colors.textMuted, fontSize: 12.5, fontWeight: '600'},
    rowValue: {flexShrink: 1, color: colors.textPrimary, fontSize: 12.5, fontWeight: '700', textAlign: 'right'},
    rowValueDanger: {color: colors.danger},
    warningText: {color: colors.danger, fontSize: 11.5, marginBottom: 10},
    confirmButton: {borderRadius: 14, paddingVertical: 15, alignItems: 'center'},
    confirmBuy: {backgroundColor: colors.gain},
    confirmSell: {backgroundColor: colors.danger},
    confirmButtonText: {color: '#fff', fontSize: 14.5, fontWeight: '800'},
    hint: {color: colors.textMuted, fontSize: 10.5, textAlign: 'center', marginTop: 10},
  });
}
