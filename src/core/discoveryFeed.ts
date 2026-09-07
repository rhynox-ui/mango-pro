// src/core/discoveryFeed.ts
//
// Real data for Home's discovery dashboard, replacing
// src/data/mockDiscovery.ts's hardcoded array (build plan §4 — "swap
// this array for a live DexScreener trending fetch"). Three independent
// real sources, one per filter that can honestly be populated today:
//
// - Trending: DexScreener's own token-boosts endpoint (real paid
//   attention signal — the same public API this app already depends on
//   for search/charts, docs.dexscreener.com), hydrated with a real
//   price/mcap/24h lookup per token via the same /latest/dex/tokens/
//   endpoint resolveDexScreenerPair() already uses.
// - Graduated / Bonding: pump.fun's own frontend-api (unofficial, not
//   published API-reference docs, but widely relied on across the
//   Solana meme-coin tooling ecosystem for exactly this — listing coins
//   by bonding-curve completion state). Solana-only by nature: pump.fun
//   itself is Solana-only, same scope this app's own pumpfun.ts already
//   treats it with. Flagged here as the one source in this file that
//   isn't a documented, stable API — if it starts failing consistently,
//   that's this endpoint changing/blocking, not a bug in this code.
//
// "Most held" has NO real source behind it — that would mean either
// on-chain holder counts across arbitrary tokens (no free bulk API for
// this) or "held by Mango Pro's own users" (this app has no aggregate
// user data at all, only one local device's own history). Deliberately
// NOT wired to a fetch at all; HomeScreen shows an honest "not tracked
// yet" state for it rather than mislabeling Trending's data as
// something it isn't.
//
// Every function here resolves to {tokens, error} rather than throwing
// — a failed fetch is a real, recoverable UI state (same discipline
// tokenSearch.ts/dexScreener.ts already hold themselves to), not a crash.

import {chainKeyForDexScreenerChainId, type DexScreenerPair} from './dexScreener';
import type {ChainKey} from './chainData';

export type DiscoveryToken = {
  chainKey: ChainKey;
  tokenAddress: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number | null;
  change24h: number | null;
  marketCapUsd: number | null;
};

export type DiscoveryResult = {tokens: DiscoveryToken[]; error: string | null};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------
// Trending — DexScreener token boosts, hydrated with real market data.

type DexScreenerBoost = {chainId?: string; tokenAddress?: string};

const TRENDING_CANDIDATE_LIMIT = 20;
const TRENDING_RESULT_LIMIT = 15;

async function hydrateBoostedToken(chainKey: ChainKey, dexScreenerChainId: string, tokenAddress: string): Promise<DiscoveryToken | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as {pairs?: DexScreenerPair[]};
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
    let best: DexScreenerPair | null = null;
    let bestLiquidity = -1;
    for (const pair of pairs) {
      if (pair?.chainId !== dexScreenerChainId) continue;
      const liquidity = num(pair?.liquidity?.usd) ?? 0;
      if (liquidity > bestLiquidity) {
        bestLiquidity = liquidity;
        best = pair;
      }
    }
    if (!best) return null;
    const info = (best as {info?: {imageUrl?: string}})?.info;
    return {
      chainKey,
      tokenAddress,
      symbol: String(best.baseToken?.symbol ?? '?'),
      name: String(best.baseToken?.name ?? best.baseToken?.symbol ?? 'Unknown token'),
      imageUrl: typeof info?.imageUrl === 'string' ? info.imageUrl : null,
      priceUsd: num(best.priceUsd),
      change24h: num(best.priceChange?.h24),
      marketCapUsd: num(best.marketCap ?? best.fdv),
    };
  } catch {
    return null;
  }
}

/**
 * Real trending tokens: DexScreener's own currently-boosted list (a real
 * signal — projects pay to be here — not a fabricated "trending" score),
 * filtered to chains this app supports, then hydrated one call per token
 * for real price/change/mcap. Bounded to TRENDING_CANDIDATE_LIMIT
 * candidates so a slow/large boost list can't turn this into dozens of
 * parallel requests — same "don't hammer the API" discipline this app's
 * own history with GeckoTerminal 429s already established elsewhere.
 */
export async function fetchTrendingTokens(): Promise<DiscoveryResult> {
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/top/v1');
    if (!res.ok) return {tokens: [], error: `DexScreener returned ${res.status}.`};
    const body = (await res.json()) as DexScreenerBoost[] | {boosts?: DexScreenerBoost[]};
    const boosts = Array.isArray(body) ? body : Array.isArray(body?.boosts) ? body.boosts : [];

    const seen = new Set<string>();
    const candidates: {chainKey: ChainKey; dexScreenerChainId: string; tokenAddress: string}[] = [];
    for (const boost of boosts) {
      if (candidates.length >= TRENDING_CANDIDATE_LIMIT) break;
      const dexScreenerChainId = boost?.chainId;
      const tokenAddress = boost?.tokenAddress;
      if (!dexScreenerChainId || !tokenAddress) continue;
      const chainKey = chainKeyForDexScreenerChainId(dexScreenerChainId);
      if (!chainKey) continue; // a real chain we just don't route trades on
      const dedupeKey = `${chainKey}:${tokenAddress.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push({chainKey, dexScreenerChainId, tokenAddress});
    }

    const hydrated = await Promise.all(candidates.map(c => hydrateBoostedToken(c.chainKey, c.dexScreenerChainId, c.tokenAddress)));
    const tokens = hydrated.filter((t): t is DiscoveryToken => t !== null).slice(0, TRENDING_RESULT_LIMIT);
    return {tokens, error: null};
  } catch (err) {
    return {tokens: [], error: err instanceof Error ? err.message : 'Could not reach DexScreener.'};
  }
}

// ---------------------------------------------------------------------
// Graduated / Bonding — pump.fun's own frontend-api. Solana-only.

type PumpFunCoin = {
  mint?: string;
  symbol?: string;
  name?: string;
  image_uri?: string;
  usd_market_cap?: number;
  market_cap?: number;
  complete?: boolean;
};

const PUMP_FUN_RESULT_LIMIT = 20;

function mapPumpFunCoin(coin: PumpFunCoin): DiscoveryToken | null {
  const mint = coin?.mint;
  if (typeof mint !== 'string' || !mint) return null;
  return {
    chainKey: 'solana',
    tokenAddress: mint,
    symbol: String(coin.symbol ?? '?'),
    name: String(coin.name ?? coin.symbol ?? 'Unknown token'),
    imageUrl: typeof coin.image_uri === 'string' ? coin.image_uri : null,
    // pump.fun's own listing doesn't carry a live USD price per-token
    // (that's a DEX/pool-derived number, not something the launch API
    // itself tracks) — never guessed here, left null rather than
    // computed from the bonding-curve formula this app already has
    // elsewhere (pumpfun.ts), which would silently drift from whatever
    // price a real trade actually executes at.
    priceUsd: null,
    change24h: null,
    marketCapUsd: num(coin.usd_market_cap ?? coin.market_cap),
  };
}

/**
 * pump.fun's frontend-api is unofficial (no published API reference) —
 * widely used across Solana meme-coin tooling for exactly this, but not
 * a documented, stable contract the way DexScreener's public API is.
 * Failure here (blocked, rate-limited, shape changed) surfaces as a
 * real "couldn't load" state, never a crash or fabricated fallback.
 */
async function fetchPumpFunCoins(complete: boolean): Promise<DiscoveryResult> {
  try {
    const res = await fetch(
      `https://frontend-api.pump.fun/coins?offset=0&limit=${PUMP_FUN_RESULT_LIMIT}&sort=market_cap&order=DESC&includeNsfw=false&complete=${complete}`,
    );
    if (!res.ok) return {tokens: [], error: `pump.fun returned ${res.status}.`};
    const body = (await res.json()) as PumpFunCoin[];
    if (!Array.isArray(body)) return {tokens: [], error: 'Unexpected response from pump.fun.'};
    const tokens = body.map(mapPumpFunCoin).filter((t): t is DiscoveryToken => t !== null);
    return {tokens, error: null};
  } catch (err) {
    return {tokens: [], error: err instanceof Error ? err.message : 'Could not reach pump.fun.'};
  }
}

/** Tokens that have graduated off pump.fun's bonding curve onto a real PumpSwap/DEX pool. */
export function fetchGraduatedTokens(): Promise<DiscoveryResult> {
  return fetchPumpFunCoins(true);
}

/** Tokens still on pump.fun's bonding curve, ranked by market cap. */
export function fetchBondingTokens(): Promise<DiscoveryResult> {
  return fetchPumpFunCoins(false);
}
