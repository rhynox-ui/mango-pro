// src/wallet/txHistory.ts
//
// Real, persisted trade history. Real execution has existed since
// executeRelayQuote.ts landed, but a completed trade's tx hash was only
// ever shown on TokenTradeScreen's own ephemeral "Trade sent" result —
// gone the moment the amount changed or the screen unmounted, with no
// way to look back and confirm something went through. Scoped port of
// mango-mobile's own src/wallet/txHistory.js: same AsyncStorage-backed
// shape and cancellation-safe hydrate/subscribe pattern.
//
// Real, requested durability, same explicit ask mobile's own header
// documents: history should survive a reinstall, not just live in this
// device's AsyncStorage. Ported byte-for-byte in spirit (adapted to this
// file's own entry shape): syncs to the SAME already-live mango-bridge.jsx
// backend mobile already uses (api/v1/history/sync.js + list.js,
// txHistoryStore.js's salted-per-address Vercel Blob store — NOT the
// Upstash Redis instance the referral system uses; that store's own
// header explains why it moved off Redis) — keyed by whichever address
// (EVM or Solana) actually originated the entry, same as mobile. No
// signature required for a write (txHistoryStore.js's own header: this
// is an activity log, not money or points — the worst a bad write can
// do is cosmetically pollute one address's own feed, rate-limited same
// as every other api/v1/* endpoint). Both calls are best-effort: a
// failed sync/fetch never blocks or breaks anything the on-device store
// already does on its own; the device is always the primary source of
// truth for a session that's actually online.
const HISTORY_SYNC_URL = 'https://mangoprotocol.site/api/v1/history/sync';
const HISTORY_LIST_URL = 'https://mangoprotocol.site/api/v1/history/list';

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
  /**
   * Real gap this closes: every entry used to be forced through the
   * binary isBuySide (Bought/Sold) label, which was never true for a
   * Convert (cash-to-cash, no token traded) and — before this — a
   * Withdrawal wasn't recorded here at all. Optional and additive so
   * every entry already on a device before this field existed (they all
   * predate it) keeps rendering exactly as it did: every read site below
   * falls back to the old isBuySide-based label when `kind` is absent.
   * 'buy'/'sell' are set for parity but not actually read anywhere yet
   * (isBuySide already covers that case) — included so a future read
   * site doesn't have to special-case "no kind means buy/sell".
   */
  kind?: 'buy' | 'sell' | 'convert' | 'withdrawal';
  /**
   * The TRADED token's own contract/mint address — the receive side on
   * a Buy, the pay side on a Sell — added for openPositions.ts to
   * aggregate real net-held amounts per token. Optional: entries
   * written before this field existed simply don't contribute to Open
   * Positions rather than being misattributed to the wrong token by a
   * symbol-only guess (a ticker isn't unique across chains/tokens).
   */
  tokenAddress?: string;
  /** Same real-logo-or-none contract as everywhere else this app shows an icon — never fabricated when absent. */
  tokenImageUrl?: string | null;
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
  // Only a record with a real hash is worth backing up — txHistoryStore.js's
  // own validateHistoryEntry rejects a hard "failed" entry (nothing ever
  // broadcast) server-side anyway, since a reinstall has nothing real to
  // recover there; skipping the call here avoids a request that would
  // just 400. fromAddress is required too (the sync key) — every real
  // call site already passes it, but one that somehow doesn't just
  // silently skips syncing rather than syncing to a wrong/missing key.
  const hasRealHash = record.hashes.some(h => typeof h === 'string' && h);
  if (hasRealHash && record.fromAddress) {
    fetch(HISTORY_SYNC_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        address: record.fromAddress,
        // The backend's validateHistoryEntry requires chainKey/kind/status
        // plus a hash. record.kind (added for Convert/Withdrawal entries —
        // see this file's own TxHistoryEntry type) is the real kind when a
        // caller set one; falls back to synthesizing buy/sell from
        // isBuySide for the entries that predate `kind` or never set it.
        entry: {...record, kind: record.kind ?? (record.isBuySide ? 'buy' : 'sell')},
      }),
    }).catch(() => {});
  }
  return record;
}

/**
 * Fetches this address's own server-synced history and merges it into
 * the on-device list — the real recovery path after a reinstall. Same
 * reasoning and safety properties as mobile's own syncTxHistoryFromServer:
 * additive only (a synced entry whose hash is already known locally is
 * skipped — the device's own copy, written the moment it actually
 * happened, is always the more complete/authoritative one for anything
 * already known), nothing is ever removed from the local list based on
 * what the server does or doesn't have, and a network failure here just
 * means "nothing recovered this time," never a broken local list. Call
 * once per address once it's known (e.g. right after unlock) — safe to
 * call repeatedly.
 */
export async function syncTxHistoryFromServer(address: string | undefined): Promise<void> {
  if (!address) return;
  try {
    const res = await fetch(`${HISTORY_LIST_URL}?address=${encodeURIComponent(address)}`);
    if (!res.ok) return;
    const {data} = (await res.json()) as {data?: {entries?: TxHistoryEntry[]}};
    const remoteEntries = Array.isArray(data?.entries) ? data.entries : [];
    if (remoteEntries.length === 0) return;
    const localHashes = new Set(entries.flatMap(e => e.hashes).filter(Boolean));
    const newOnes = remoteEntries.filter(e => e.hashes?.some(h => h && !localHashes.has(h)));
    if (newOnes.length === 0) return;
    entries = [...entries, ...newOnes].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ENTRIES);
    persist();
    notify();
  } catch {
    // Best-effort only — see this function's own comment.
  }
}

/**
 * Shared title/subtitle logic for HistoryScreen.tsx and
 * NotificationHistoryScreen.tsx — kept in one place so the two views
 * can't drift on how a Convert or Withdrawal entry reads, the way they
 * would if each screen re-derived its own label from isBuySide.
 */
export function historyEntryTitle(entry: TxHistoryEntry): string {
  if (entry.kind === 'convert') return `Converted ${entry.paySymbol} → ${entry.receiveSymbol} on ${entry.chainLabel}`;
  if (entry.kind === 'withdrawal') return `Withdrew ${entry.paySymbol} on ${entry.chainLabel}`;
  return `${entry.isBuySide ? 'Bought' : 'Sold'} ${entry.isBuySide ? entry.receiveSymbol : entry.paySymbol} on ${entry.chainLabel}`;
}

export function historyEntrySubtitle(entry: TxHistoryEntry): string {
  if (entry.status === 'error') {
    return entry.errorMessage ?? (entry.kind === 'withdrawal' ? 'Withdrawal failed' : entry.kind === 'convert' ? 'Conversion failed' : 'Trade failed');
  }
  if (entry.kind === 'withdrawal') return `${entry.payAmount} ${entry.paySymbol} sent`;
  return `${entry.payAmount} ${entry.paySymbol} → ${entry.receivedAmountFormatted ?? '?'} ${entry.receiveSymbol}`;
}

const SOLANA_EXPLORER_TX_BASE = 'https://solscan.io/tx/';

/** Real block-explorer tx URL, or null for a chain with no verified explorer. */
export function explorerUrlFor(chainKey: ChainKey, hash: string | undefined): string | null {
  if (!hash) return null;
  if (chainKey === 'solana') return `${SOLANA_EXPLORER_TX_BASE}${hash}`;
  const base = CHAIN_KEY_TO_VIEM_CHAIN[chainKey]?.blockExplorers?.default?.url;
  return base ? `${base}/tx/${hash}` : null;
}
