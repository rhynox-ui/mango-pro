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

import {useEffect, useState} from 'react';
import {Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ChevronLeftIcon} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {explorerUrlFor} from '../wallet/txHistory';
import type {ChainKey} from '../core/chainData';
import {
  getNotificationHistory,
  isNotificationHistoryHydrated,
  markNotificationsViewed,
  subscribeNotificationHistory,
  type NotificationHistoryEntry,
} from '../notifications/notificationHistory';

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
  const [entries, setEntries] = useState<NotificationHistoryEntry[]>(() => getNotificationHistory());
  const [hydrated, setHydrated] = useState(isNotificationHistoryHydrated());

  useEffect(() => {
    const unsubscribe = subscribeNotificationHistory(next => {
      setEntries(next);
      setHydrated(true);
    });
    setHydrated(isNotificationHistoryHydrated());
    // Clears the bell's unread dot the moment this screen is actually
    // seen, not just opened-and-immediately-backed-out-of.
    markNotificationsViewed();
    return unsubscribe;
  }, []);

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Notifications</Text>
      {!hydrated ? null : entries.length === 0 ? (
        <Text style={styles.emptyText}>No notifications yet — a real deposit landing in your wallet will show up here.</Text>
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
