// src/wallet/openPositions.ts
//
// Real Open Positions: what's actually still held, derived from
// txHistory.ts's own persisted trades — not a live on-chain balance
// scan (this app has no reason to assume a chain's RPC can cheaply
// enumerate every token an address holds), but the net of every
// successful Buy (adds tokenAddress's amount) minus every successful
// Sell (removes it) for this account. A trade written before
// tokenAddress/tokenImageUrl existed (txHistory.ts's own header)
// simply can't be attributed to a token and is skipped, rather than
// guessed at by symbol alone — a ticker isn't unique across chains or
// even within one (two unrelated tokens can share a symbol).
//
// Live $ value comes from dexScreener.ts's own resolveDexScreenerPair —
// the same source TokenChartPanel already trusts for this app's charts
// — multiplied by the held amount. A token DexScreener hasn't indexed
// (or a network hiccup) resolves to a null price, shown honestly as
// "—" rather than a fabricated number; the position itself still shows
// with its real held amount.

import {resolveDexScreenerPair} from '../core/dexScreener.ts';
import type {ChainKey} from '../core/chainData';
import type {TxHistoryEntry} from './txHistory';

export type OpenPosition = {
  key: string;
  chainKey: ChainKey;
  chainLabel: string;
  tokenAddress: string;
  symbol: string;
  imageUrl: string | null;
  amountHeld: number;
};

export type OpenPositionWithValue = OpenPosition & {valueUsd: number | null};

// EVM addresses compare case-insensitively; Solana addresses are
// case-sensitive — same convention filterTxHistoryForAccount already
// uses for the same reason.
function normalizedTokenKey(chainKey: ChainKey, tokenAddress: string): string {
  return `${chainKey}:${chainKey === 'solana' ? tokenAddress : tokenAddress.toLowerCase()}`;
}

// Below this, a position reads as "closed" rather than a dust remainder
// left over from float arithmetic on formatted display amounts (these
// come from payAmount/receivedAmountFormatted — already-rounded strings,
// not base units — so exact-zero cancellation isn't guaranteed).
const DUST_EPSILON = 1e-9;

/**
 * Aggregates net-held amount per (chainKey, tokenAddress) across every
 * successful trade. Entries are expected already scoped to one account
 * (filterTxHistoryForAccount) — this function doesn't re-check
 * ownership.
 */
export function computeOpenPositions(entries: TxHistoryEntry[]): OpenPosition[] {
  const byKey = new Map<string, OpenPosition>();
  // Oldest first, so a later trade's symbol/imageUrl (a search index
  // that resolved an icon after an earlier trade didn't) is what wins.
  const chronological = [...entries].filter(e => e.status === 'success' && e.tokenAddress).sort((a, b) => a.timestamp - b.timestamp);

  for (const entry of chronological) {
    const tokenAddress = entry.tokenAddress!;
    const amount = Number(entry.isBuySide ? entry.receivedAmountFormatted : entry.payAmount);
    if (!Number.isFinite(amount)) continue;
    const delta = entry.isBuySide ? amount : -amount;
    const symbol = entry.isBuySide ? entry.receiveSymbol : entry.paySymbol;
    const key = normalizedTokenKey(entry.chainKey, tokenAddress);

    const existing = byKey.get(key);
    if (existing) {
      existing.amountHeld += delta;
      existing.symbol = symbol;
      if (entry.tokenImageUrl) existing.imageUrl = entry.tokenImageUrl;
    } else {
      byKey.set(key, {
        key,
        chainKey: entry.chainKey,
        chainLabel: entry.chainLabel,
        tokenAddress,
        symbol,
        imageUrl: entry.tokenImageUrl ?? null,
        amountHeld: delta,
      });
    }
  }

  return [...byKey.values()].filter(p => p.amountHeld > DUST_EPSILON);
}

/** Attaches a live $ value to each position, in parallel, one DexScreener lookup per position (already short-lived-cached there). */
export async function withLiveValues(positions: OpenPosition[]): Promise<OpenPositionWithValue[]> {
  return Promise.all(
    positions.map(async position => {
      const pair = await resolveDexScreenerPair({chainKey: position.chainKey, tokenAddress: position.tokenAddress});
      const valueUsd = pair?.priceUsd != null ? pair.priceUsd * position.amountHeld : null;
      return {...position, valueUsd};
    }),
  );
}
