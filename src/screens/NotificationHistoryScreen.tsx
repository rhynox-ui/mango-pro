// src/screens/NotificationHistoryScreen.tsx
//
// Real in-app notification history — the Profile header's bell icon
// was a dead spot before this (there was no bell at all, and no way to
// look back at a deposit alert once the OS notification itself was
// dismissed). Ported from mango-mobile's own
// src/notifications/NotificationHistoryScreen.tsx: same shape, adapted
// to this app's own screen convention (a plain back-button + title, per
// HistoryScreen.tsx — this app has no shared ScreenHeader component)
// and its own explorerUrlFor (src/wallet/txHistory.ts).
//
// This screen's own feed is wider than notificationHistory.ts's
// persisted store: that store only ever logs depositWatcher.ts's real
// deposit alert (the one thing that fires an actual OS notification
// here — see that file's own header for why a trade result doesn't
// also log there, TradeResultModal.tsx already gives it a real in-app
// result). But a single "Notifications" screen that only shows
// deposits and silently drops every trade reads as broken, not scoped
// — so this view merges in real trade history (txHistory.ts) at render
// time, sorted alongside deposit alerts by timestamp, each with its own
// real explorer link. Two different real stores, one merged view; the
// underlying deposit-only persistence semantics of notificationHistory.ts
// itself are untouched.

import {useEffect, useMemo, useState} from 'react';
import {Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ChevronLeftIcon} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {useSession} from '../wallet/SessionContext';
import {explorerUrlFor, filterTxHistoryForAccount, getTxHistory, subscribeTxHistory, type TxHistoryEntry} from '../wallet/txHistory';
import type {ChainKey} from '../core/chainData';
import {
  getNotificationHistory,
  isNotificationHistoryHydrated,
  markNotificationsViewed,
  subscribeNotificationHistory,
  type NotificationHistoryEntry,
} from '../notifications/notificationHistory';

/** A completed trade, reshaped into the same {title, body, chainKey, txHash} rows deposit alerts already render as — same Row component, same explorer-link behavior, no special-casing needed downstream. */
function tradeToEntry(trade: TxHistoryEntry): NotificationHistoryEntry {
  const title = trade.status === 'error' ? 'Trade failed' : `${trade.isBuySide ? 'Bought' : 'Sold'} ${trade.isBuySide ? trade.receiveSymbol : trade.paySymbol} on ${trade.chainLabel}`;
  const body =
    trade.status === 'error'
      ? (trade.errorMessage ?? 'This trade did not go through.')
      : `${trade.payAmount} ${trade.paySymbol} → ${trade.receivedAmountFormatted ?? '?'} ${trade.receiveSymbol}`;
  return {id: `trade:${trade.id}`, timestamp: trade.timestamp, title, body, chainKey: trade.chainKey, txHash: trade.hashes[0]};
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  if (sameDay) return time;
  return `${d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})} · ${time}`;
}

function truncateHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function Row({entry, colors}: {entry: NotificationHistoryEntry; colors: Colors}) {
  const styles = makeStyles(colors);
  const explorerUrl = entry.txHash && entry.chainKey ? explorerUrlFor(entry.chainKey as ChainKey, entry.txHash) : null;
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={explorerUrl ? 0.7 : 1}
      disabled={!explorerUrl}
      onPress={() => explorerUrl && Linking.openURL(explorerUrl)}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={styles.rowBody} numberOfLines={2}>
          {entry.body}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowTime}>{formatTimestamp(entry.timestamp)}</Text>
        {entry.txHash && <Text style={explorerUrl ? styles.rowHashLink : styles.rowHash}>{truncateHash(entry.txHash)}</Text>}
      </View>
    </TouchableOpacity>
  );
}

export function NotificationHistoryScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {session} = useSession();
  const [notifications, setNotifications] = useState<NotificationHistoryEntry[]>(() => getNotificationHistory());
  const [hydrated, setHydrated] = useState(isNotificationHistoryHydrated());
  const [trades, setTrades] = useState<TxHistoryEntry[]>(() => getTxHistory());

  useEffect(() => {
    const unsubscribe = subscribeNotificationHistory(next => {
      setNotifications(next);
      setHydrated(true);
    });
    setHydrated(isNotificationHistoryHydrated());
    // Clears the bell's unread dot the moment this screen is actually
    // seen, not just opened-and-immediately-backed-out-of.
    markNotificationsViewed();
    return unsubscribe;
  }, []);

  useEffect(() => subscribeTxHistory(setTrades), []);

  const entries = useMemo(() => {
    const scopedTrades = session ? filterTxHistoryForAccount(trades, {evmAddress: session.evm.address, solanaAddress: session.solana.address}) : trades;
    return [...notifications, ...scopedTrades.map(tradeToEntry)].sort((a, b) => b.timestamp - a.timestamp);
  }, [notifications, trades, session]);

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Notifications</Text>
      {!hydrated ? null : entries.length === 0 ? (
        <Text style={styles.emptyText}>Nothing yet — a real deposit or a completed trade will show up here.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
          {entries.map(entry => (
            <Row key={entry.id} entry={entry} colors={colors} />
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
    rows: {paddingBottom: 32},
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      gap: 10,
    },
    rowMain: {flex: 1, minWidth: 0},
    rowTitle: {color: colors.textPrimary, fontSize: 13.5, fontWeight: '700'},
    rowBody: {color: colors.textMuted, fontSize: 11.5, marginTop: 2},
    rowRight: {alignItems: 'flex-end', flexShrink: 0},
    rowTime: {color: colors.textMuted, fontSize: 11},
    rowHash: {color: colors.textMuted, fontSize: 10.5, fontFamily: 'monospace', marginTop: 2},
    rowHashLink: {color: colors.accent, fontSize: 10.5, fontFamily: 'monospace', marginTop: 2, textDecorationLine: 'underline'},
  });
}
