// src/core/dexScreener.ts
//
// Ported verbatim from mango-bridge.jsx's src/dexScreenerChart.js (itself
// a verbatim port of mango-mobile's wallet/dexScreenerChart.js) — same
// chain-slug map, same "exact chainId match only, highest-liquidity pair
// wins" resolution, same embed flags. No edits beyond the TypeScript
// types: this exact logic already resolves real pairs correctly in
// production on both other surfaces.

import type {ChainKey} from './chainData';

// DexScreener chain slugs, as they appear both in dexscreener.com URLs
// and as the `chainId` field of its API responses. Anything not listed
// resolves to null and the caller shows an "unavailable" state rather
// than guessing a slug from the chain name.
const DEXSCREENER_CHAIN_IDS: Partial<Record<ChainKey, string>> = {
  ethereum: 'ethereum',
  base: 'base',
  bnb: 'bsc',
  solana: 'solana',
  arbitrum: 'arbitrum',
  avalanche: 'avalanche',
  robinhood: 'robinhood',
  abstract: 'abstract',
  hyperevm: 'hyperevm',
  ink: 'ink',
  plasma: 'plasma',
  unichain: 'unichain',
  xlayer: 'xlayer',
};

export function dexScreenerChainForChain(chainKey: ChainKey): string | null {
  return DEXSCREENER_CHAIN_IDS[chainKey] ?? null;
}

let reverseChainIds: Map<string, ChainKey> | null = null;

/**
 * The other direction of the map above — a DexScreener search result
 * carries DexScreener's own chainId string, not our ChainKey, so search
 * has to map it back. Returns null for any chain DexScreener covers that
 * we don't (or can't yet route trades on) rather than guessing.
 */
export function chainKeyForDexScreenerChainId(dexScreenerChainId: string): ChainKey | null {
  if (!reverseChainIds) {
    reverseChainIds = new Map(Object.entries(DEXSCREENER_CHAIN_IDS).map(([key, id]) => [id as string, key as ChainKey]));
  }
  return reverseChainIds.get(dexScreenerChainId) ?? null;
}

export type ResolvedPair = {chainId: string; pairAddress: string};

// The handful of fields this app actually reads off a DexScreener API
// pair object — not the full response shape, just enough to type-check
// the parsing below without pretending to know every field DexScreener
// might send.
export type DexScreenerPair = {
  chainId?: string;
  pairAddress?: string;
  liquidity?: {usd?: number};
  baseToken?: {address?: string; symbol?: string; name?: string};
  priceUsd?: string;
  priceChange?: {h24?: number};
  marketCap?: number;
  fdv?: number;
};

/**
 * Finds the deepest real DexScreener pair for a token on one chain.
 * Resolves to null — never throws — for every "no chart here" case: an
 * unmapped chain, a network failure, or a token DexScreener has never
 * indexed on that exact chain. A token address can legitimately exist on
 * several chains (bridged assets especially), so pairs are filtered to
 * an EXACT chainId match before ranking by liquidity — "first pair
 * returned" would risk charting the wrong network's price.
 */
export async function resolveDexScreenerPair({chainKey, tokenAddress}: {chainKey: ChainKey; tokenAddress: string | null}): Promise<ResolvedPair | null> {
  const chainId = dexScreenerChainForChain(chainKey);
  if (!chainId || !tokenAddress) return null;
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as {pairs?: DexScreenerPair[]};
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
    let best: string | null = null;
    let bestLiquidity = -1;
    for (const pair of pairs) {
      if (pair?.chainId !== chainId) continue;
      if (typeof pair?.pairAddress !== 'string' || !pair.pairAddress) continue;
      const liquidity = Number(pair?.liquidity?.usd);
      const ranked = Number.isFinite(liquidity) ? liquidity : 0;
      if (ranked > bestLiquidity) {
        bestLiquidity = ranked;
        best = pair.pairAddress;
      }
    }
    return best ? {chainId, pairAddress: best} : null;
  } catch {
    return null;
  }
}

/**
 * Builds the embeddable chart URL. Every flag switches off a piece of
 * DexScreener's full page that has no business inside a chart panel this
 * size (trades feed, pair info panel, tab bar, chart-left toolbar) —
 * DexScreener's own in-page timeframe selector is what's left to switch
 * intervals, matching the fix already applied to both sibling apps'
 * equivalent panels (their own custom interval-pill rows were removed
 * for duplicating this exact embed control).
 */
export function dexScreenerEmbedUrl({chainId, pairAddress, theme}: {chainId: string; pairAddress: string; theme: 'light' | 'dark'}): string {
  const params = [
    'embed=1',
    `theme=${theme}`,
    `chartTheme=${theme}`,
    'trades=0',
    'info=0',
    'tabs=0',
    'chartLeftToolbar=0',
    'loadChartSettings=0',
    'chartDefaultOnMobile=1',
    'chartType=usd',
    'interval=60',
  ].join('&');
  return `https://dexscreener.com/${chainId}/${pairAddress}?${params}`;
}
