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
// for, plus NEAR once NEAR trading is on (tradeChainForDexScreenerChainId
// returns null otherwise) — a result
// this app can't map to a ChainKey can't be handed to the trade screen,
// so it's dropped rather than shown as a dead row.

import {tradeChainForDexScreenerChainId, type DexScreenerPair} from './dexScreener';
import type {TradeChain} from './chainData';

export type TokenSearchResult = {
  chainKey: TradeChain;
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
const MANGO_API_AVE_XLAYER_SEARCH = 'https://mangoprotocol.site/api/v1/search/ave-xlayer';

async function searchAveXlayer(query: string): Promise<TokenSearchResult[]> {
  try {
    const response = await fetch(`${MANGO_API_AVE_XLAYER_SEARCH}?q=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    const body = (await response.json()) as {data?: TokenSearchResult[]};
    const data = Array.isArray(body?.data) ? body.data : [];
    return data.filter(item =>
      item?.chainKey === 'xlayer' &&
      typeof item?.tokenAddress === 'string' &&
      typeof item?.symbol === 'string',
    );
  } catch {
    return [];
  }
}

async function searchDexScreener(query: string): Promise<TokenSearchResult[]> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    const body = (await response.json()) as {pairs?: DexScreenerPair[]};
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];

    const bestByKey = new Map<string, TokenSearchResult>();
    for (const pair of pairs) {
      const chainKey = pair?.chainId ? tradeChainForDexScreenerChainId(pair.chainId) : null;
      const tokenAddress = pair?.baseToken?.address;
      if (!chainKey || typeof tokenAddress !== 'string' || !tokenAddress) continue;

      const liquidityUsd = Number(pair?.liquidity?.usd);
      const rankedLiquidity = Number.isFinite(liquidityUsd) ? liquidityUsd : 0;
      const dedupeKey = `${chainKey}:${tokenAddress.toLowerCase()}`;
      const existing = bestByKey.get(dedupeKey);

      const info = (pair as {info?: {imageUrl?: string}})?.info;
      const imageUrl = typeof info?.imageUrl === 'string' ? info.imageUrl : null;

      if (existing && existing.liquidityUsd >= rankedLiquidity) {
        if (!existing.imageUrl && imageUrl) {
          bestByKey.set(dedupeKey, {...existing, imageUrl});
        }
        continue;
      }

      const priceUsd = Number(pair?.priceUsd);
      const change24h = Number(pair?.priceChange?.h24);
      const marketCapUsd = Number(pair?.marketCap ?? pair?.fdv);

      bestByKey.set(dedupeKey, {
        chainKey,
        tokenAddress,
        symbol: String(pair?.baseToken?.symbol ?? '?'),
        name: String(pair?.baseToken?.name ?? pair?.baseToken?.symbol ?? 'Unknown token'),
        imageUrl: imageUrl ?? existing?.imageUrl ?? null,
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

/**
 * Searches DexScreener exactly as before, then augments the result set with
 * AVE's X Layer discovery feed. AVE is deliberately discovery-only here:
 * selecting a result still enters the existing trade screen and its existing
 * DexScreener chart resolver, so the chart/UI path is not replaced.
 */
export async function searchTokens(query: string): Promise<TokenSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [dexResults, aveXlayerResults] = await Promise.all([
    searchDexScreener(trimmed),
    searchAveXlayer(trimmed),
  ]);

  const merged = new Map<string, TokenSearchResult>();
  for (const result of dexResults) {
    merged.set(`${result.chainKey}:${result.tokenAddress.toLowerCase()}`, result);
  }
  for (const result of aveXlayerResults) {
    const key = `${result.chainKey}:${result.tokenAddress.toLowerCase()}`;
    const existing = merged.get(key);
    // AVE is the dedicated X Layer discovery source. If DexScreener already
    // knows the same token, keep DexScreener's row because it preserves the
    // current result semantics; otherwise add AVE's richer X Layer discovery.
    if (!existing) merged.set(key, result);
  }

  return Array.from(merged.values()).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}
