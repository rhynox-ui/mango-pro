// src/core/tokenSearch.ts
//
// Real token-first search (build plan §4): DexScreener's public search
// endpoint, no API key. Same trust boundary as dexScreener.ts's chart
// resolution — DexScreener is already the source both sibling apps'
// charts are built on — and the same "exact chain match, rank by real
// liquidity" discipline: a query can match a token that's deployed (or
// merely name-collides) on several chains, and the wrong one silently
// winning would point a trade at the wrong network's contract.
//
// Results are filtered to chains this app actually has chain/fee data
// for (chainKeyForDexScreenerChainId returns null otherwise) — a result
// this app can't map to a ChainKey can't be handed to the trade screen,
// so it's dropped rather than shown as a dead row.

import {chainKeyForDexScreenerChainId, type DexScreenerPair} from './dexScreener';
import type {ChainKey} from './chainData';

export type TokenSearchResult = {
  chainKey: ChainKey;
  tokenAddress: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number | null;
  change24h: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number;
};

export function fmtCompactUsd(n: number | null): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/**
 * Searches DexScreener for `query`, dedupes to one row per (chain, token
 * address) — the highest-liquidity pair for that token wins, same rule
 * resolveDexScreenerPair already uses for charts — then ranks the
 * remaining rows by liquidity. Resolves to [] rather than throwing for
 * every failure case (network error, empty query, no matches): search
 * results disappearing is a normal, recoverable UI state, not an error
 * screen.
 */
export async function searchTokens(query: string): Promise<TokenSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(trimmed)}`);
    if (!response.ok) return [];
    const body = (await response.json()) as {pairs?: DexScreenerPair[]};
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];

    const bestByKey = new Map<string, TokenSearchResult>();
    for (const pair of pairs) {
      const chainKey = pair?.chainId ? chainKeyForDexScreenerChainId(pair.chainId) : null;
      const tokenAddress = pair?.baseToken?.address;
      if (!chainKey || typeof tokenAddress !== 'string' || !tokenAddress) continue;

      const liquidityUsd = Number(pair?.liquidity?.usd);
      const rankedLiquidity = Number.isFinite(liquidityUsd) ? liquidityUsd : 0;

      const dedupeKey = `${chainKey}:${tokenAddress.toLowerCase()}`;
      const existing = bestByKey.get(dedupeKey);
      if (existing && existing.liquidityUsd >= rankedLiquidity) continue;

      const priceUsd = Number(pair?.priceUsd);
      const change24h = Number(pair?.priceChange?.h24);
      const marketCapUsd = Number(pair?.marketCap ?? pair?.fdv);
      // Same field discoveryFeed.ts's own hydrateBoostedToken already
      // reads off a DexScreener pair — not part of DexScreenerPair's
      // typed shape (only Trending's own boost-hydration path declared
      // it before), so read the same way: an inline cast, never fabricated.
      const info = (pair as {info?: {imageUrl?: string}})?.info;

      bestByKey.set(dedupeKey, {
        chainKey,
        tokenAddress,
        symbol: String(pair?.baseToken?.symbol ?? '?'),
        name: String(pair?.baseToken?.name ?? pair?.baseToken?.symbol ?? 'Unknown token'),
        imageUrl: typeof info?.imageUrl === 'string' ? info.imageUrl : null,
        priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
        change24h: Number.isFinite(change24h) ? change24h : null,
        marketCapUsd: Number.isFinite(marketCapUsd) ? marketCapUsd : null,
        liquidityUsd: rankedLiquidity,
      });
    }

    return Array.from(bestByKey.values()).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  } catch {
    return [];
  }
}
