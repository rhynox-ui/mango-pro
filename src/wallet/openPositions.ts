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
import type {TradeChain} from '../core/chainData';
import type {TxHistoryEntry} from './txHistory';

export type OpenPosition = {
  key: string;
  chainKey: TradeChain;
  chainLabel: string;
  tokenAddress: string;
  symbol: string;
  imageUrl: string | null;
  amountHeld: number;
  lastTradeAt: number;
  /** Cost-weighted market cap at the user's buys; null when historical buys predate entry-MC tracking. */
  entryMarketCapUsd: number | null;
};

export type OpenPositionWithValue = OpenPosition & {valueUsd: number | null; currentMarketCapUsd: number | null};

/** A token that was bought and is now fully sold back out — net amount at/near zero. Shows in the Positions "Closed" tab, one row per token exited, not one row per trade. */
export type ClosedPosition = {
  key: string;
  chainKey: TradeChain;
  chainLabel: string;
  tokenAddress: string;
  symbol: string;
  imageUrl: string | null;
  lastTradeAt: number;
};

// EVM addresses compare case-insensitively; Solana addresses are
// case-sensitive — same convention filterTxHistoryForAccount already
// uses for the same reason.
function normalizedTokenKey(chainKey: TradeChain, tokenAddress: string): string {
  return `${chainKey}:${chainKey === 'solana' ? tokenAddress : tokenAddress.toLowerCase()}`;
}

// Below this, a position reads as "closed" rather than a dust remainder
// left over from float arithmetic on formatted display amounts (these
// come from payAmount/receivedAmountFormatted — already-rounded strings,
// not base units — so exact-zero cancellation isn't guaranteed).
const DUST_EPSILON = 1e-9;

// A real round-trip's leftover almost never lands within 1e-9 of zero —
// slippage between the buy and sell prices, and the buy/sell amounts
// both being independently-rounded display strings, routinely leave a
// remainder many orders of magnitude larger than that, especially for
// tokens traded in the thousands/millions. Fixed EPSILON alone meant a
// token someone had genuinely fully exited almost never registered as
// closed. Judging "closed" relative to how much was ever bought (a
// leftover under 0.5% of the total position) absorbs that real-world
// rounding without needing an exact zero.
const CLOSED_DUST_FRACTION = 0.005;

/**
 * Aggregates net-held amount per (chainKey, tokenAddress) across every
 * successful trade — shared by computeOpenPositions (still held) and
 * computeClosedPositions (fully exited) below, so "which token, on
 * which chain, how much is left" is computed exactly once and the two
 * tabs can never disagree about it. Entries are expected already
 * scoped to one account (filterTxHistoryForAccount) — this function
 * doesn't re-check ownership.
 */
// Internal only — totalBought is what CLOSED_DUST_FRACTION needs to
// judge "closed" relative to position size; neither OpenPosition nor
// ClosedPosition expose it publicly.
type AggregatedPosition = OpenPosition & {totalBought: number; entryMarketCapCost: number; entryMarketCapWeight: number};

function aggregatePositionsByToken(entries: TxHistoryEntry[]): AggregatedPosition[] {
  const byKey = new Map<string, AggregatedPosition>();
  // Oldest first, so a later trade's symbol/imageUrl (a search index
  // that resolved an icon after an earlier trade didn't) is what wins,
  // and lastTradeAt naturally ends up as the most recent timestamp.
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
      if (entry.isBuySide) {
        existing.totalBought += amount;
        const entryMc = Number(entry.entryMarketCapUsd);
        const buyCostUsd = Number(entry.payAmount);
        if (Number.isFinite(entryMc) && entryMc > 0 && Number.isFinite(buyCostUsd) && buyCostUsd > 0) {
          existing.entryMarketCapCost += entryMc * buyCostUsd;
          existing.entryMarketCapWeight += buyCostUsd;
          existing.entryMarketCapUsd = existing.entryMarketCapCost / existing.entryMarketCapWeight;
        }
      }
      existing.symbol = symbol;
      existing.lastTradeAt = entry.timestamp;
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
        totalBought: entry.isBuySide ? amount : 0,
        entryMarketCapUsd: entry.isBuySide && Number.isFinite(Number(entry.entryMarketCapUsd)) && Number(entry.entryMarketCapUsd) > 0 && Number.isFinite(Number(entry.payAmount)) && Number(entry.payAmount) > 0 ? Number(entry.entryMarketCapUsd) : null,
        entryMarketCapCost: entry.isBuySide && Number.isFinite(Number(entry.entryMarketCapUsd)) && Number(entry.entryMarketCapUsd) > 0 && Number.isFinite(Number(entry.payAmount)) && Number(entry.payAmount) > 0 ? Number(entry.entryMarketCapUsd) * Number(entry.payAmount) : 0,
        entryMarketCapWeight: entry.isBuySide && Number.isFinite(Number(entry.entryMarketCapUsd)) && Number(entry.entryMarketCapUsd) > 0 && Number.isFinite(Number(entry.payAmount)) && Number(entry.payAmount) > 0 ? Number(entry.payAmount) : 0,
        lastTradeAt: entry.timestamp,
      });
    }
  }

  return [...byKey.values()];
}

// Shared by both functions below so a position can never land in BOTH
// tabs at once (or neither) — "closed" and "still held" are each
// other's exact complement, not two independently-tuned thresholds that
// could disagree on the same position.
function isDust(position: AggregatedPosition): boolean {
  return Math.abs(position.amountHeld) <= Math.max(DUST_EPSILON, position.totalBought * CLOSED_DUST_FRACTION);
}

/** Tokens still genuinely held — a real, non-dust net amount left after every Buy/Sell nets out. */
export function computeOpenPositions(entries: TxHistoryEntry[]): OpenPosition[] {
  return aggregatePositionsByToken(entries).filter(p => p.amountHeld > 0 && !isDust(p));
}

/**
 * Tokens that were bought and are now fully sold back out — the
 * Positions "Closed" tab's real content. Reusing the SAME per-token
 * aggregation as computeOpenPositions above (rather than just showing
 * every past trade) is the actual fix here: a wallet that bought and
 * sold the same token five times used to show as five separate rows
 * even though nothing about it is "open" anymore — now it's the one
 * row a fully-closed position actually is. A net amount that overshoots
 * slightly negative (a Sell nudging past its matching Buy on rounded
 * display amounts) still reads as closed, not as a phantom short
 * position this app has no concept of. Newest-closed first.
 */
export function computeClosedPositions(entries: TxHistoryEntry[]): ClosedPosition[] {
  return aggregatePositionsByToken(entries)
    .filter(p => p.totalBought > 0 && isDust(p))
    .sort((a, b) => b.lastTradeAt - a.lastTradeAt)
    .map(({amountHeld: _amountHeld, totalBought: _totalBought, ...closed}) => closed);
}

/** Attaches a live $ value to each position, in parallel, one DexScreener lookup per position (already short-lived-cached there). */
export async function withLiveValues(positions: OpenPosition[]): Promise<OpenPositionWithValue[]> {
  return Promise.all(
    positions.map(async position => {
      const pair = await resolveDexScreenerPair({chainKey: position.chainKey, tokenAddress: position.tokenAddress});
      const valueUsd = pair?.priceUsd != null ? pair.priceUsd * position.amountHeld : null;
      return {...position, valueUsd, currentMarketCapUsd: pair?.marketCapUsd ?? null};
    }),
  );
}
