// src/core/usdcBalances.ts
//
// Aggregates a wallet's USDC balance across every chain this app has a
// verified USDC address for — the concrete answer to "can deposits be
// accepted on all chains we trade on, not just one default chain": yes,
// and this is what makes that a real number instead of a UI promise.
//
// The chain list is derived FROM chainData.ts's own TOKEN_ADDRESSES.USDC
// (Object.keys), not duplicated here — adding USDC support for a new
// chain in chainData.ts is the only edit needed for it to show up here
// too, same "one source of truth" discipline chainData.ts's own header
// already asks for.
//
// Uses Promise.allSettled deliberately, not Promise.all: one chain's RPC
// hiccup must not blank the whole total for a user who has real USDC on
// four other chains. Callers get both the best-effort sum AND which
// chains failed, so a partial result can be shown as partial — never
// silently presented as complete when it isn't.

import {TOKEN_ADDRESSES, ASSET_ONCHAIN_DECIMALS, assetDecimalsForChain, type ChainKey} from './chainData.ts';
import {fetchWalletSplTokenBalance, fetchWalletTokenBalance} from '../wallet/walletRpc.ts';
import type {DerivedAccounts} from '../wallet/keys';

/** Every chain this app has a verified USDC contract/mint address for — see this file's own header for why this is derived, not a separate hardcoded list. */
export const USDC_SUPPORTED_CHAINS = Object.keys(TOKEN_ADDRESSES.USDC ?? {}) as ChainKey[];

export type ChainUsdcResult = {chainKey: ChainKey; status: 'ok'; balance: number} | {chainKey: ChainKey; status: 'error'; error: string};

export type UsdcPortfolio = {
  results: ChainUsdcResult[];
  totalUsd: number;
  /** True when every chain answered — false means totalUsd is a real but INCOMPLETE sum, not the user's actual total. */
  complete: boolean;
};

async function fetchOneChainUsdc(chainKey: ChainKey, session: DerivedAccounts): Promise<number> {
  const address = TOKEN_ADDRESSES.USDC[chainKey];
  if (!address) throw new Error(`No verified USDC address for ${chainKey}.`);
  // Real bug this fixes: BNB Chain's own USDC contract uses 18 decimals,
  // not the usual 6 (chainData.ts's own ASSET_ONCHAIN_DECIMALS_BY_CHAIN
  // override) — reading it as 6 would misreport the balance by a factor
  // of 10^12. assetDecimalsForChain already knows this per chain; a flat
  // ASSET_ONCHAIN_DECIMALS.USDC constant here silently ignored it.
  const decimals = assetDecimalsForChain(chainKey, 'USDC') ?? ASSET_ONCHAIN_DECIMALS.USDC;
  if (chainKey === 'solana') {
    return fetchWalletSplTokenBalance(address, decimals, session.solana.address);
  }
  return fetchWalletTokenBalance(chainKey, address, decimals, session.evm.address);
}

export async function fetchUsdcPortfolio(session: DerivedAccounts): Promise<UsdcPortfolio> {
  const settled = await Promise.allSettled(USDC_SUPPORTED_CHAINS.map(chainKey => fetchOneChainUsdc(chainKey, session)));

  const results: ChainUsdcResult[] = settled.map((outcome, i) => {
    const chainKey = USDC_SUPPORTED_CHAINS[i];
    if (outcome.status === 'fulfilled') {
      return {chainKey, status: 'ok', balance: outcome.value};
    }
    const error = outcome.reason instanceof Error ? outcome.reason.message : 'Could not fetch this chain\'s balance.';
    return {chainKey, status: 'error', error};
  });

  const totalUsd = results.reduce((sum, r) => (r.status === 'ok' ? sum + r.balance : sum), 0);
  const complete = results.every(r => r.status === 'ok');

  return {results, totalUsd, complete};
}

// Real per-chain "cash" asset — USDC everywhere it exists, USDG on
// Robinhood Chain (its own real, native stablecoin; there is no USDC
// contract there at all — see chainData.ts's own header on why). This
// is the deliberate "USDC everywhere, except where the real asset is
// different" model FOMO's own reference behavior uses (confirmed via
// research, not guessed: FOMO lets users deposit/withdraw real USDG on
// Robinhood Chain and folds it into the same one-balance total).
//
// USDC_SUPPORTED_CHAINS/fetchUsdcPortfolio above stay UNCHANGED and
// USDC-only on purpose — nothing should ever claim Robinhood Chain has
// real USDC, since it doesn't. This CASH_* pair is the separate,
// additive concept for the general "real spendable dollar balance"
// idea instead: ProfileScreen's Total cash/Deposit/Withdraw AND
// TokenTradeScreen's "Pay from"/"Receive as" pickers all switched to
// this, so a wallet holding USDG on Robinhood can actually spend or
// receive it — cross-chain via Relay on TokenTradeScreen, same as USDC
// anywhere else — instead of that balance being trapped on Robinhood
// with no way to use it for a trade on a different chain.
export const CASH_ASSET_BY_CHAIN: Partial<Record<ChainKey, 'USDC' | 'USDG'>> = {
  ...Object.fromEntries(USDC_SUPPORTED_CHAINS.map(c => [c, 'USDC' as const])),
  robinhood: 'USDG',
};
export const CASH_SUPPORTED_CHAINS = Object.keys(CASH_ASSET_BY_CHAIN) as ChainKey[];

export type ChainCashResult =
  | {chainKey: ChainKey; asset: 'USDC' | 'USDG'; status: 'ok'; balance: number}
  | {chainKey: ChainKey; asset: 'USDC' | 'USDG'; status: 'error'; error: string};

export type CashPortfolio = {
  results: ChainCashResult[];
  totalUsd: number;
  complete: boolean;
};

async function fetchOneChainCash(chainKey: ChainKey, session: DerivedAccounts): Promise<number> {
  const asset = CASH_ASSET_BY_CHAIN[chainKey];
  if (!asset) throw new Error(`No verified cash asset for ${chainKey}.`);
  const address = TOKEN_ADDRESSES[asset]?.[chainKey];
  if (!address) throw new Error(`No verified ${asset} address for ${chainKey}.`);
  const decimals = assetDecimalsForChain(chainKey, asset) ?? ASSET_ONCHAIN_DECIMALS[asset];
  if (chainKey === 'solana') {
    return fetchWalletSplTokenBalance(address, decimals, session.solana.address);
  }
  return fetchWalletTokenBalance(chainKey, address, decimals, session.evm.address);
}

/** Same shape/discipline as fetchUsdcPortfolio above, over CASH_SUPPORTED_CHAINS instead. */
export async function fetchCashPortfolio(session: DerivedAccounts): Promise<CashPortfolio> {
  const settled = await Promise.allSettled(CASH_SUPPORTED_CHAINS.map(chainKey => fetchOneChainCash(chainKey, session)));

  const results: ChainCashResult[] = settled.map((outcome, i) => {
    const chainKey = CASH_SUPPORTED_CHAINS[i];
    const asset = CASH_ASSET_BY_CHAIN[chainKey] as 'USDC' | 'USDG';
    if (outcome.status === 'fulfilled') {
      return {chainKey, asset, status: 'ok', balance: outcome.value};
    }
    const error = outcome.reason instanceof Error ? outcome.reason.message : "Could not fetch this chain's balance.";
    return {chainKey, asset, status: 'error', error};
  });

  const totalUsd = results.reduce((sum, r) => (r.status === 'ok' ? sum + r.balance : sum), 0);
  const complete = results.every(r => r.status === 'ok');

  return {results, totalUsd, complete};
}
