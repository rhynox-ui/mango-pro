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
      const result = payload as WalletAssetsResult;
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
