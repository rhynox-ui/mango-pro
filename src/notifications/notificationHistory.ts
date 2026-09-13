// src/notifications/notificationHistory.ts
//
// In-app record of what localNotify.ts has actually fired — TS port of
// mango-mobile's own src/notifications/notificationHistory.js (same
// AsyncStorage-backed pub-sub shape txHistory.ts already established
// in this app for the same reason: a real record, not just a cache —
// losing an entry here means losing it for good).
//
// Scope: mango-mobile's version logs every send/bridge result; this
// app has no equivalent system notification for a trade result (a
// completed trade already gets a real, can't-miss in-app result via
// TradeResultModal.tsx, so a second OS notification for the same event
// would be redundant) — the one thing that fires a real Android
// notification here is depositWatcher.ts's deposit-detected alert
// (localNotify.ts's notify()), so that's what's logged. Structured the
// same way mango-mobile's version is specifically so a second source
// (a future trade-related push, a price alert, etc.) is a one-line
// addNotificationHistoryEntry call away, not a redesign.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'mango_pro_notification_history_v1';
const LAST_VIEWED_KEY = 'mango_pro_notification_history_last_viewed_v1';
const MAX_ENTRIES = 50;

export type NotificationHistoryEntry = {
  id: string;
  timestamp: number;
  title: string;
  body: string;
  chainKey?: string;
  txHash?: string;
};

let entries: NotificationHistoryEntry[] = [];
let hydrated = false;
let lastViewedAt = 0;
const listeners = new Set<(entries: NotificationHistoryEntry[]) => void>();

function notify(): void {
  for (const listener of listeners) {
    listener(entries);
  }
}

function persist(): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
}

AsyncStorage.getItem(STORAGE_KEY)
  .then(raw => {
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) entries = parsed;
  })
  .catch(() => {})
  .finally(() => {
    hydrated = true;
    notify();
  });

AsyncStorage.getItem(LAST_VIEWED_KEY)
  .then(raw => {
    const parsed = raw ? Number(raw) : 0;
    lastViewedAt = Number.isFinite(parsed) ? parsed : 0;
  })
  .catch(() => {});

export function isNotificationHistoryHydrated(): boolean {
  return hydrated;
}

export function getNotificationHistory(): NotificationHistoryEntry[] {
  return entries;
}

export function subscribeNotificationHistory(listener: (entries: NotificationHistoryEntry[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** chainKey/txHash are optional — only an entry with a real on-chain transaction to point at carries them; NotificationHistoryScreen.tsx simply shows no explorer link when they're absent. */
export function addNotificationHistoryEntry({title, body, chainKey, txHash}: {title: string; body: string; chainKey?: string; txHash?: string}): NotificationHistoryEntry {
  const record: NotificationHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    title,
    body,
    chainKey,
    txHash,
  };
  entries = [record, ...entries].slice(0, MAX_ENTRIES);
  persist();
  notify();
  return record;
}

/** Whether anything has arrived since the notification history screen was last opened — drives the bell's unread dot. */
export function hasUnseenNotifications(): boolean {
  return entries.length > 0 && entries[0].timestamp > lastViewedAt;
}

/** Call when the notification history screen opens, so the unread dot clears. */
export function markNotificationsViewed(): void {
  lastViewedAt = Date.now();
  AsyncStorage.setItem(LAST_VIEWED_KEY, String(lastViewedAt)).catch(() => {});
}
