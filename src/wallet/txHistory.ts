// src/wallet/txHistory.ts
//
// Real, persisted trade history. Real execution has existed since
// executeRelayQuote.ts landed, but a completed trade's tx hash was only
// ever shown on TokenTradeScreen's own ephemeral "Trade sent" result —
// gone the moment the amount changed or the screen unmounted, with no
// way to look back and confirm something went through. Scoped port of
// mango-mobile's own src/wallet/txHistory.js: same AsyncStorage-backed
// shape and cancellation-safe hydrate/subscribe pattern, but local-only
// — that file's own server-sync (survives a reinstall) depends on a
// mango-bridge.jsx backend endpoint this app has no reason to assume is
// reachable or intended for it; add that later if reinstall-durability
// is ever actually asked for, not speculatively now.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {CHAIN_KEY_TO_VIEM_CHAIN} from '../core/chainRegistry.ts';
import type {ChainKey} from '../core/chainData';

const STORAGE_KEY = 'mango_pro_tx_history_v1';
const MAX_ENTRIES = 200;

export type TxHistoryEntry = {
  id: string;
  timestamp: number;
  status: 'success' | 'error';
  chainKey: ChainKey;
  chainLabel: string;
  isBuySide: boolean;
  paySymbol: string;
  receiveSymbol: string;
  payAmount: string;
  receivedAmountFormatted: string | null;
  hashes: string[];
  errorMessage?: string;
  fromAddress?: string;
};

let entries: TxHistoryEntry[] = [];
let hydrated = false;
const listeners = new Set<(entries: TxHistoryEntry[]) => void>();

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

export function isTxHistoryHydrated(): boolean {
  return hydrated;
}

export function getTxHistory(): TxHistoryEntry[] {
  return entries;
}

export function subscribeTxHistory(listener: (entries: TxHistoryEntry[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Scopes a history list down to one account's own entries — same
 * reasoning mobile's own filterTxHistoryForAccount documents: EVM
 * addresses compare case-insensitively, Solana addresses compare
 * exactly (case is significant there). An entry with no fromAddress
 * (written before this field existed, or a caller that somehow skipped
 * it) is kept rather than hidden, so it never just silently vanishes.
 */
export function filterTxHistoryForAccount(list: TxHistoryEntry[], {evmAddress, solanaAddress}: {evmAddress?: string; solanaAddress?: string}): TxHistoryEntry[] {
  return list.filter(entry => {
    if (!entry.fromAddress) return true;
    if (entry.chainKey === 'solana') return entry.fromAddress === solanaAddress;
    return !!evmAddress && entry.fromAddress.toLowerCase() === evmAddress.toLowerCase();
  });
}

export function addTxHistoryEntry(entry: Omit<TxHistoryEntry, 'id' | 'timestamp'>): TxHistoryEntry {
  const record: TxHistoryEntry = {id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, timestamp: Date.now(), ...entry};
  entries = [record, ...entries].slice(0, MAX_ENTRIES);
  persist();
  notify();
  return record;
}

const SOLANA_EXPLORER_TX_BASE = 'https://solscan.io/tx/';

/** Real block-explorer tx URL, or null for a chain with no verified explorer. */
export function explorerUrlFor(chainKey: ChainKey, hash: string | undefined): string | null {
  if (!hash) return null;
  if (chainKey === 'solana') return `${SOLANA_EXPLORER_TX_BASE}${hash}`;
  const base = CHAIN_KEY_TO_VIEM_CHAIN[chainKey]?.blockExplorers?.default?.url;
  return base ? `${base}/tx/${hash}` : null;
}
