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

export type ResolvedPair = {chainId: string; pairAddress: string; socialLinks: TokenSocialLink[]};

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
  volume?: {h24?: number};
  txns?: {h24?: {buys?: number; sells?: number}};
  /** Unix ms — DexScreener's own "when this pair was created" field, used as this token's listed age. */
  pairCreatedAt?: number;
  info?: {imageUrl?: string; websites?: {label?: string; url?: string}[]; socials?: {type?: string; url?: string}[]};
};

export type TokenSocialLink = {kind: 'x' | 'telegram' | 'website'; url: string};

/** DexScreener's own info.socials `type` strings, as actually seen on real pairs — 'twitter' still (never renamed to 'x' in their API despite the platform rename). Anything else (discord, medium, ...) has no icon in this row and is left out rather than guessed into the wrong bucket. */
function socialKindFor(type: string | undefined): 'x' | 'telegram' | null {
  if (type === 'twitter' || type === 'x') return 'x';
  if (type === 'telegram') return 'telegram';
  return null;
}

/** One link per kind, first-seen-wins — DexScreener can list more than one of the same social type on a fake/duplicate submission, and a dedicated row here has room for one icon per kind, not a scrollable list. Never fabricates a link a pair doesn't actually carry. */
function extractSocialLinks(pair: DexScreenerPair | undefined): TokenSocialLink[] {
  const links: TokenSocialLink[] = [];
  const seen = new Set<string>();
  const add = (kind: TokenSocialLink['kind'], url: string | undefined) => {
    if (!url || seen.has(kind)) return;
    seen.add(kind);
    links.push({kind, url});
  };
  for (const social of pair?.info?.socials ?? []) {
    const kind = socialKindFor(social?.type);
    if (kind) add(kind, social?.url);
  }
  const website = pair?.info?.websites?.find(w => typeof w?.url === 'string' && w.url);
  add('website', website?.url);
  return links;
}

// Short-lived cache + in-flight dedup, same reasoning as
// usdcBalances.ts's own portfolio cache: TokenChartPanel re-runs this on
// every chainKey/tokenAddress change, and bouncing between a few tokens
// (or navigating away from one and back) is a completely normal usage
// pattern this was re-hitting DexScreener's API for every single time,
// for data that's realistically unchanged within a short window. A null
// result (no pair found, or a fetch failure) is cached too — same "the
// answer for this exact token isn't going to change a second later"
// reasoning, and a genuinely new pair getting indexed is worth a
// deliberate re-check, not an instant one.
const PAIR_CACHE_TTL_MS = 30_000;
const pairCache = new Map<string, {data: ResolvedPair | null; fetchedAt: number}>();
const pairInFlight = new Map<string, Promise<ResolvedPair | null>>();

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

  const key = `${chainId}:${tokenAddress.toLowerCase()}`;
  const cached = pairCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < PAIR_CACHE_TTL_MS) return cached.data;
  const inFlight = pairInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = resolveDexScreenerPairUncached(chainId, tokenAddress).then(data => {
    pairCache.set(key, {data, fetchedAt: Date.now()});
    return data;
  });
  pairInFlight.set(key, promise);
  promise.finally(() => pairInFlight.delete(key));
  return promise;
}

async function resolveDexScreenerPairUncached(chainId: string, tokenAddress: string): Promise<ResolvedPair | null> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as {pairs?: DexScreenerPair[]};
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
    let best: DexScreenerPair | null = null;
    let bestLiquidity = -1;
    for (const pair of pairs) {
      if (pair?.chainId !== chainId) continue;
      if (typeof pair?.pairAddress !== 'string' || !pair.pairAddress) continue;
      const liquidity = Number(pair?.liquidity?.usd);
      const ranked = Number.isFinite(liquidity) ? liquidity : 0;
      if (ranked > bestLiquidity) {
        bestLiquidity = ranked;
        best = pair;
      }
    }
    // Social links come off this SAME winning pair, not a second lookup —
    // the highest-liquidity pair is already the one this app trusts for
    // price/chart data, so its own info.socials/websites is the same
    // trust boundary, not a new one.
    return best ? {chainId, pairAddress: best.pairAddress as string, socialLinks: extractSocialLinks(best)} : null;
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
