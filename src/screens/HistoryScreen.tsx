// src/screens/HistoryScreen.tsx
//
// The Profile header's own History icon was a dead no-op button before
// this — now it opens the real thing: every trade TokenTradeScreen has
// executed, persisted by src/wallet/txHistory.ts. Scoped to this
// account only (filterTxHistoryForAccount), newest first (the store
// already keeps it that way). Tapping a row with a real hash opens the
// chain's own block explorer — the same source of truth a signature
// always has, rather than this app trying to be one.

import {useEffect, useState} from 'react';
import {Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ChevronLeftIcon} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {useSession} from '../wallet/SessionContext';
import {explorerUrlFor, filterTxHistoryForAccount, getTxHistory, subscribeTxHistory, type TxHistoryEntry} from '../wallet/txHistory';

function formatWhen(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
}

function HistoryRow({entry}: {entry: TxHistoryEntry}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const hash = entry.hashes[0];
  const url = explorerUrlFor(entry.chainKey, hash);

  return (
    <TouchableOpacity style={styles.row} activeOpacity={url ? 0.6 : 1} disabled={!url} onPress={() => url && Linking.openURL(url)}>
      <View style={[styles.statusDot, entry.status === 'error' && styles.statusDotError]} />
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>
          {entry.isBuySide ? 'Bought' : 'Sold'} {entry.isBuySide ? entry.receiveSymbol : entry.paySymbol} on {entry.chainLabel}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {entry.status === 'error'
            ? (entry.errorMessage ?? 'Trade failed')
            : `${entry.payAmount} ${entry.paySymbol} → ${entry.receivedAmountFormatted ?? '?'} ${entry.receiveSymbol}`}
        </Text>
      </View>
      <Text style={styles.rowWhen}>{formatWhen(entry.timestamp)}</Text>
    </TouchableOpacity>
  );
}

export function HistoryScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {session} = useSession();
  const [entries, setEntries] = useState<TxHistoryEntry[]>(getTxHistory());

  useEffect(() => subscribeTxHistory(setEntries), []);

  const scoped = session ? filterTxHistoryForAccount(entries, {evmAddress: session.evm.address, solanaAddress: session.solana.address}) : entries;

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>History</Text>
      {scoped.length === 0 ? (
        <Text style={styles.emptyText}>No trades yet — your executed trades will show up here.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
          {scoped.map(entry => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16},
    backButton: {paddingTop: 8, paddingBottom: 4, alignSelf: 'flex-start'},
    title: {color: colors.textPrimary, fontSize: 34, fontWeight: '800', marginTop: 6, marginBottom: 8},
    emptyText: {color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 60},
    rows: {paddingBottom: 32, gap: 2},
    row: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider},
    statusDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gain, flexShrink: 0},
    statusDotError: {backgroundColor: colors.danger},
    rowMain: {flex: 1, minWidth: 0},
    rowTitle: {color: colors.textPrimary, fontSize: 13.5, fontWeight: '700'},
    rowSubtitle: {color: colors.textMuted, fontSize: 11.5, marginTop: 2},
    rowWhen: {color: colors.textMuted, fontSize: 11, flexShrink: 0},
  });
}
