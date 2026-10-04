// src/wallet/walletAssets.ts
//
// Live fungible holdings for the connected Mango wallet. This is deliberately
// separate from txHistory/openPositions: a wallet can receive a token from
// outside Mango and it must still appear immediately.
//
// The indexing-provider key stays server-side in mango-api. The response
// contains fungible assets with a positive on-chain balance; NFTs are
// intentionally excluded because Mango's trade screen cannot swap them.

import type {TradeChain} from '../core/chainData';

export type WalletAsset = {
  key: string;
  chainKey: TradeChain;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  amount: number;
  valueUsd: number | null;
  priceUsd: number | null;
  imageUrl: string | null;
  isNative: boolean;
};

export type WalletAssetsResult = {
  holdings: WalletAsset[];
  totalValueUsd: number;
  complete: boolean;
  partialErrors: Array<{provider?: string; error?: string; network?: string}>;
};


function sanitizeWalletAsset(asset: WalletAsset): WalletAsset | null {
  if (!asset || typeof asset.key !== 'string' || typeof asset.chainKey !== 'string' || typeof asset.address !== 'string') return null;
  const decimals = Number(asset.decimals);
  const amount = Number(asset.amount);
  const valueUsd = asset.valueUsd == null ? null : Number(asset.valueUsd);
  const priceUsd = asset.priceUsd == null ? null : Number(asset.priceUsd);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (valueUsd != null && (!Number.isFinite(valueUsd) || valueUsd < 0)) return null;
  if (priceUsd != null && (!Number.isFinite(priceUsd) || priceUsd < 0)) return null;
  const symbol = typeof asset.symbol === 'string' && asset.symbol.trim() ? asset.symbol.trim() : 'UNKNOWN';
  const isUnknown = symbol.toUpperCase() === 'UNKNOWN';
  return {
    ...asset,
    symbol,
    name: typeof asset.name === 'string' && asset.name.trim() ? asset.name.trim() : symbol,
    decimals,
    amount,
    // Do not trust a USD valuation attached to an unverified UNKNOWN asset.
    // The raw holding can still be shown via the explicit "Show hidden" control.
    valueUsd: isUnknown ? null : valueUsd,
    priceUsd: isUnknown ? null : priceUsd,
  };
}

function sanitizeWalletAssets(result: WalletAssetsResult): WalletAssetsResult {
  const holdings = Array.isArray(result.holdings)
    ? result.holdings.map(sanitizeWalletAsset).filter((asset): asset is WalletAsset => asset !== null)
    : [];
  const totalValueUsd = Number(result.totalValueUsd);
  return {
    ...result,
    holdings,
    totalValueUsd: Number.isFinite(totalValueUsd) && totalValueUsd >= 0 ? totalValueUsd : 0,
    complete: result.complete === true,
    partialErrors: Array.isArray(result.partialErrors) ? result.partialErrors : [],
  };
}

const API_URL = 'https://mangoprotocol.site/api/v1/pro/wallet-assets';
const CACHE_TTL_MS = 20_000;
let cachedKey: string | null = null;
let cachedAt = 0;
let cachedResult: WalletAssetsResult | null = null;
let inFlight: Promise<WalletAssetsResult> | null = null;

export async function fetchWalletAssets(
  evmAddress: string,
  solanaAddress: string,
  nearAddress: string | null = null,
  {forceFresh = false}: {forceFresh?: boolean} = {},
): Promise<WalletAssetsResult> {
  const key = `${evmAddress.toLowerCase()}:${solanaAddress}:${nearAddress || ''}`;
  if (!forceFresh && cachedResult && cachedKey === key && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }
  if (!forceFresh && inFlight) return inFlight;

  inFlight = fetch(API_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({evmAddress, solanaAddress, nearAddress}),
  })
    .then(async response => {
      const payload = (await response.json().catch(() => null)) as {error?: string} | null;
      if (!response.ok) throw new Error(payload?.error || `Wallet asset index failed: ${response.status}`);
      const result = sanitizeWalletAssets(payload as WalletAssetsResult);
      cachedKey = key;
      cachedAt = Date.now();
      cachedResult = result;
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
