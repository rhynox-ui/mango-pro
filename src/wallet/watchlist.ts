// src/wallet/watchlist.ts
//
// Real, persisted watchlist for Home's discovery dashboard — the
// "Watchlist" tab existed before this only as a tab selector with no
// real data behind it (both tabs rendered the exact same list). Same
// AsyncStorage-backed shape and cancellation-safe hydrate/subscribe
// pattern as this app's own txHistory.ts, local-only for the same
// reason that file gives: no backend to sync a watchlist against.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {DiscoveryToken} from '../core/discoveryFeed';

const STORAGE_KEY = 'mango_pro_watchlist_v1';

let entries: DiscoveryToken[] = [];
let hydrated = false;
// Real bug this closes: a star tap (toggleWatchlist) firing in the
// window before this module's own AsyncStorage.getItem() resolves — very
// plausible on a cold start, since Home's own network fetch for Trending
// can render tappable rows before this local disk read finishes — used
// to get silently discarded the instant hydration DID resolve, because
// the hydration callback below overwrote `entries` unconditionally with
// whatever was on disk BEFORE that tap, with no idea a tap had happened
// in the meantime. Tracked here so hydration only ever applies to a
// still-pristine, never-mutated store.
let mutatedBeforeHydration = false;
const listeners = new Set<(entries: DiscoveryToken[]) => void>();

function keyFor(token: Pick<DiscoveryToken, 'chainKey' | 'tokenAddress'>): string {
  return `${token.chainKey}:${token.tokenAddress.toLowerCase()}`;
}

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
    if (mutatedBeforeHydration || !raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) entries = parsed;
  })
  .catch(() => {})
  .finally(() => {
    hydrated = true;
    notify();
  });

export function isWatchlistHydrated(): boolean {
  return hydrated;
}

export function getWatchlist(): DiscoveryToken[] {
  return entries;
}

export function subscribeWatchlist(listener: (entries: DiscoveryToken[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isWatchlisted(token: Pick<DiscoveryToken, 'chainKey' | 'tokenAddress'>): boolean {
  const key = keyFor(token);
  return entries.some(e => keyFor(e) === key);
}

/** Adds if absent, removes if present — returns the new state (true = now watchlisted). */
export function toggleWatchlist(token: DiscoveryToken): boolean {
  const key = keyFor(token);
  const exists = entries.some(e => keyFor(e) === key);
  entries = exists ? entries.filter(e => keyFor(e) !== key) : [token, ...entries];
  persist();
  notify();
  return !exists;
}
