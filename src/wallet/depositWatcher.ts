// src/wallet/depositWatcher.ts
//
// Detects an external deposit landing in the wallet — a real balance
// increase this app did NOT cause itself — and fires a local
// notification (localNotify.ts) for it. "External" is what makes this
// different from just watching cashPortfolio's total go up: a
// completed Sell trade, a Convert, or a Withdraw's own refresh all
// raise or lower that same total, and none of those are a "deposit".
//
// The approach: every caller that fetches a fresh cash-portfolio total
// for this wallet calls checkForDeposit(address, totalUsd). Any
// increase over the last-known total is treated as a deposit UNLESS
// this app itself just completed a trade/convert/withdraw in the last
// COOLDOWN_MS — those call markOwnAction(address) right when they
// complete. The baseline (lastKnownTotalUsd) is updated on every call
// regardless of whether it notified, so a within-cooldown own-action
// self-corrects the baseline to the real post-action total without
// ever needing the caller to pass that total into markOwnAction
// itself — the next real fetch does that naturally.
//
// First-ever check for a given address seeds the baseline silently
// (never fires a notification for a balance that was already there
// before this feature existed, or before the wallet was ever opened).

import AsyncStorage from '@react-native-async-storage/async-storage';
import {notify} from '../notifications/localNotify';
import {addNotificationHistoryEntry} from '../notifications/notificationHistory';

const STORAGE_PREFIX = 'mango_pro_deposit_watch_v1:';
const EPSILON_USD = 0.01;
const COOLDOWN_MS = 45_000;

type WatchState = {
  lastKnownTotalUsd: number;
  lastOwnActionAt: number;
};

async function loadState(address: string): Promise<WatchState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + address);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lastKnownTotalUsd !== 'number') return null;
    return {lastKnownTotalUsd: parsed.lastKnownTotalUsd, lastOwnActionAt: typeof parsed.lastOwnActionAt === 'number' ? parsed.lastOwnActionAt : 0};
  } catch {
    return null;
  }
}

async function saveState(address: string, state: WatchState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_PREFIX + address, JSON.stringify(state));
}

/** Call right when a trade/convert/withdraw this app itself initiated completes, so the next portfolio fetch (which will show the resulting balance change) isn't mistaken for an external deposit. */
export async function markOwnAction(address: string): Promise<void> {
  const existing = await loadState(address);
  await saveState(address, {lastKnownTotalUsd: existing?.lastKnownTotalUsd ?? 0, lastOwnActionAt: Date.now()});
}

/**
 * Call with every fresh cash-portfolio total for this wallet. Fires a
 * local notification and returns the delta when it looks like a real
 * external deposit; returns null (having still updated the baseline)
 * otherwise.
 */
export async function checkForDeposit(address: string, totalUsd: number): Promise<number | null> {
  const existing = await loadState(address);
  if (!existing) {
    await saveState(address, {lastKnownTotalUsd: totalUsd, lastOwnActionAt: 0});
    return null;
  }

  const delta = totalUsd - existing.lastKnownTotalUsd;
  const withinCooldown = Date.now() - existing.lastOwnActionAt < COOLDOWN_MS;
  await saveState(address, {lastKnownTotalUsd: totalUsd, lastOwnActionAt: existing.lastOwnActionAt});

  if (delta <= EPSILON_USD || withinCooldown) return null;

  const title = 'Deposit received';
  const body = `$${delta.toFixed(2)} landed in your Mango Pro wallet.`;
  await notify(title, body);
  // Recorded at the exact point the OS notification fires, so the
  // in-app Notifications screen (opened from the Profile bell) always
  // matches what the system notification actually said — same
  // discipline mango-mobile's own notificationHistory.js documents. No
  // chainKey/txHash here: this is a balance-total observation, not a
  // specific on-chain transaction this app watched land.
  addNotificationHistoryEntry({title, body});
  return delta;
}
