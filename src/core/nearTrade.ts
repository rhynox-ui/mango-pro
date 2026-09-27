// src/core/nearTrade.ts
//
// Trading NEAR tokens with the wallet's USDC on NEAR — Mango Pro's
// USDC-first model on NEAR: Buy spends USDC on NEAR for a token, Sell
// turns a token back into USDC on NEAR. Built from pieces that already
// exist and are tested:
//   - routes: Intear's aggregator over every NEAR DEX, and the site's own
//     route checks (intearRouter.ts, ported line for line);
//   - sending: the wallet's own NEAR key, gas paid by Mango's relayer
//     (nearSigning.ts);
//   - what happened: the user's own call results from the relayer, read
//     the site's way (nearOutcome.ts) — a refunded swap is never "Bought".
//
// Mango's fee (0.5%, DEV_FEE_WALLET_NEAR) is always taken in USDC and sent
// as its own call only AFTER the swap is confirmed: a Buy pays it from the
// USDC it set aside, a Sell from the USDC it just received. A cancelled
// swap pays no fee; a partly filled one pays the same share. NEAR gas is
// covered by Mango (it costs a fraction of a cent per swap).

import {NATIVE_NEAR, NEAR_USDC, NEAR_USDC_DECIMALS} from './chainData.ts';
import {DEV_FEE_WALLET_NEAR, appFeeBps} from './fees.ts';
import {IntearRouteError, assertIntearRouteSafe, feeTransaction, fetchIntearRoutes, pickSafeRoute, type IntearRoute, type SafeRoute} from './intearRouter.ts';
import {classifySwapOutcomes, type SwapOutcomeStatus} from './nearOutcome.ts';
import {nearRpc, nearView} from './nearRpc.ts';
import {NearSendError, ensureNearAccount, sendSponsoredNearCalls, type NearCall, type NearRelayOutcome} from './nearSigning.ts';
import type {DerivedAccounts} from '../wallet/keys';

export type NearTradeSide = 'buy' | 'sell';

/** Used when the user left slippage on Auto: 1%, the site's NEAR swap default. */
export const NEAR_TRADE_DEFAULT_SLIPPAGE_BPS = 100;
/** A quote older than this is re-fetched (and re-checked) before sending. */
export const NEAR_QUOTE_MAX_AGE_MS = 20_000;
/** Mango's relayer refuses a delegate above this (near-relayer.js MAX_DELEGATE_GAS). */
export const RELAY_MAX_GAS = 300_000_000_000_000n;
/** NEAR's storage price: 10^19 yoctoNEAR per byte. */
const YOCTO_PER_BYTE = 10_000_000_000_000_000_000n;
/** NEP-145 minimum when a token contract doesn't answer storage_balance_bounds (0.00125 NEAR). */
const DEFAULT_STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n;

export class NearTradeError extends Error {}

type View = <T = any>(contractId: string, method: string, args?: unknown) => Promise<T>;
type Rpc = typeof nearRpc;
type Send = typeof sendSponsoredNearCalls;

export type NearTokenMeta = {decimals: number; symbol: string};

/** A NEP-141 token's decimals and symbol (ft_metadata). */
export async function fetchNearTokenMeta(tokenId: string, view: View = nearView): Promise<NearTokenMeta> {
  const meta = await view<{decimals?: unknown; symbol?: unknown}>(tokenId, 'ft_metadata', {});
  const decimals = Number(meta?.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new NearTradeError("Couldn't verify this token.");
  return {decimals, symbol: typeof meta?.symbol === 'string' ? meta.symbol : ''};
}

/** The wallet's balance of a NEP-141 token, in base units (0 when unregistered). */
export async function fetchNearTokenBalance(tokenId: string, accountId: string, view: View = nearView): Promise<bigint> {
  const raw = await view<string | null>(tokenId, 'ft_balance_of', {account_id: accountId});
  return typeof raw === 'string' && /^\d+$/.test(raw) ? BigInt(raw) : 0n;
}

/** Mango's fee on `usdcUnits` of USDC — 0.5%, capped at $50 (fees.ts appFeeBps). */
export function nearTradeFee(usdcUnits: bigint): bigint {
  if (usdcUnits <= 0n) return 0n;
  const usd = Number(usdcUnits) / 10 ** NEAR_USDC_DECIMALS;
  return (usdcUnits * BigInt(appFeeBps(usd))) / 10_000n;
}

export type NearTradeQuote = {
  side: NearTradeSide;
  token: string;
  /** What the user typed, in the pay token's base units. */
  payUnits: bigint;
  /** What goes into the swap: payUnits minus the fee on a Buy, payUnits on a Sell. */
  swapIn: bigint;
  tokenIn: string;
  tokenOut: string;
  route: SafeRoute;
  /** Mango's fee in USDC base units, before any partial-fill adjustment. */
  fee: bigint;
  /** What the user can expect / is guaranteed, after the fee. */
  receiveUnits: bigint;
  minReceiveUnits: bigint;
  slippageBps: number;
  quotedAt: number;
};

function totalGas(call: NearCall): bigint {
  return call.actions.reduce((sum, a) => sum + BigInt(a.params.gas), 0n);
}

/** The best route that passes every check AND fits Mango's relayer (per-call gas, no native NEAR spent). */
export function pickRelayableRoute(routes: IntearRoute[], check: {accountId: string; tokenIn: string; tokenOut: string; amountIn: bigint}): SafeRoute | null {
  for (const route of routes) {
    const picked = pickSafeRoute([route], check);
    if (picked && picked.txs.every(tx => totalGas(tx) <= RELAY_MAX_GAS)) return picked;
  }
  return null;
}

/**
 * A live quote: Buy spends `payUnits` of USDC on NEAR on `token`, Sell
 * spends `payUnits` of `token` for USDC on NEAR.
 */
export async function quoteNearTrade({
  side,
  token,
  payUnits,
  accountId,
  slippageBps,
  fetchImpl = fetch,
  now = Date.now(),
}: {
  side: NearTradeSide;
  token: string;
  payUnits: bigint;
  accountId: string;
  slippageBps?: number | null;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<NearTradeQuote> {
  if (!token || token === NATIVE_NEAR || token === NEAR_USDC) throw new NearTradeError("This token can't be traded here.");
  if (payUnits <= 0n) throw new NearTradeError('Enter an amount.');
  const bps = slippageBps != null && Number.isFinite(slippageBps) && slippageBps > 0 ? Math.round(slippageBps) : NEAR_TRADE_DEFAULT_SLIPPAGE_BPS;
  const buy = side === 'buy';
  const tokenIn = buy ? NEAR_USDC : token;
  const tokenOut = buy ? token : NEAR_USDC;
  const buyFee = buy ? nearTradeFee(payUnits) : 0n;
  const swapIn = payUnits - buyFee;
  if (swapIn <= 0n) throw new NearTradeError('This amount is too small to trade.');
  const routes = await fetchIntearRoutes({tokenIn, tokenOut, amountIn: swapIn, slippageBps: bps, accountId, fetchImpl});
  const route = pickRelayableRoute(routes, {accountId, tokenIn, tokenOut, amountIn: swapIn});
  if (!route) throw new NearTradeError(routes.length ? 'No safe route for this trade right now.' : 'No NEAR exchange can fill this trade right now.');
  const fee = buy ? buyFee : nearTradeFee(route.minOut);
  return {
    side,
    token,
    payUnits,
    swapIn,
    tokenIn,
    tokenOut,
    route,
    fee,
    receiveUnits: buy ? route.amountOut : route.amountOut - fee,
    minReceiveUnits: buy ? route.minOut : route.minOut - fee,
    slippageBps: bps,
    quotedAt: now,
  };
}

/** [register `accountId` on `tokenId`] when it isn't yet — null when it already is. */
async function storageRegistration(tokenId: string, accountId: string, view: View): Promise<{needed: boolean; deposit: bigint}> {
  const registered = await view(tokenId, 'storage_balance_of', {account_id: accountId});
  if (registered) return {needed: false, deposit: 0n};
  let deposit = DEFAULT_STORAGE_DEPOSIT;
  try {
    const bounds = await view<{min?: string}>(tokenId, 'storage_balance_bounds', {});
    if (bounds?.min && /^\d+$/.test(bounds.min)) deposit = BigInt(bounds.min);
  } catch {
    // keep the usual minimum
  }
  return {needed: true, deposit};
}

/** NEAR the account can spend: its balance minus what its stored data locks. */
async function spendableNear(accountId: string, rpc: Rpc): Promise<bigint> {
  try {
    const acct = await rpc<{amount: string; storage_usage: number | string}>('query', {request_type: 'view_account', finality: 'final', account_id: accountId});
    const locked = BigInt(acct.storage_usage) * YOCTO_PER_BYTE;
    const amount = BigInt(acct.amount);
    return amount > locked ? amount - locked : 0n;
  } catch {
    return 0n;
  }
}

function attachedNear(calls: NearCall[]): bigint {
  return calls.reduce((sum, c) => sum + c.actions.reduce((s, a) => s + BigInt(a.params.deposit), 0n), 0n);
}

export type NearTradeResult = {
  status: SwapOutcomeStatus;
  /** Swap hashes, then the fee's when one was sent. */
  hashes: string[];
  feeCharged: bigint;
  /** Set when the swap went through but Mango's fee couldn't be sent (the trade itself is unaffected). */
  feeError: string | null;
};

/** Fee owed after the swap: none when refunded, the filled share when partial. */
export function feeAfterSwap(quote: NearTradeQuote, status: SwapOutcomeStatus, usedIn: bigint | null): bigint {
  if (status === 'ok') return quote.fee;
  if (status === 'partial' && usedIn != null && quote.swapIn > 0n) return (quote.fee * usedIn) / quote.swapIn;
  return 0n;
}

function usedAmount(outcomes: NearRelayOutcome[], txs: NearCall[]): bigint | null {
  let used = 0n;
  for (let i = 0; i < txs.length; i++) {
    const last = txs[i].actions[txs[i].actions.length - 1];
    if (last?.params.methodName !== 'ft_transfer_call') continue;
    const v = outcomes[i]?.result?.SuccessValue;
    if (typeof v !== 'string') return null;
    try {
      const n = JSON.parse(Buffer.from(v, 'base64').toString('utf8'));
      if (typeof n !== 'string' || !/^\d+$/.test(n)) return null;
      used += BigInt(n);
    } catch {
      return null;
    }
  }
  return used;
}

/**
 * Sends a quote: re-quotes (and so re-checks) when it's stale, checks the
 * route once more against exactly what's shown, makes sure the wallet
 * holds what it's spending and the NEAR its storage needs, sends the swap
 * through Mango's relayer, reads what really happened, and only then
 * sends Mango's fee.
 */
export async function executeNearTrade(
  session: DerivedAccounts,
  initial: NearTradeQuote,
  {
    send = sendSponsoredNearCalls,
    view = nearView,
    rpc = nearRpc,
    ensureAccount = ensureNearAccount,
    requote,
    now = () => Date.now(),
  }: {send?: Send; view?: View; rpc?: Rpc; ensureAccount?: typeof ensureNearAccount; requote?: () => Promise<NearTradeQuote>; now?: () => number} = {},
): Promise<NearTradeResult> {
  if (!session.near) throw new NearTradeError('This wallet has no NEAR account.');
  const accountId = session.near.address;
  const fresh = requote ?? (() => quoteNearTrade({side: initial.side, token: initial.token, payUnits: initial.payUnits, accountId, slippageBps: initial.slippageBps}));
  const quote = now() - initial.quotedAt > NEAR_QUOTE_MAX_AGE_MS ? await fresh() : initial;
  if (quote.side !== initial.side || quote.token !== initial.token || quote.payUnits !== initial.payUnits) throw new NearTradeError('The trade changed — try again.');
  // Never send for less than the minimum the user was shown.
  if (quote.minReceiveUnits < initial.minReceiveUnits) throw new NearTradeError('The price moved since your quote — check the new amount and try again.');
  const {route} = quote;
  assertIntearRouteSafe(route.txs, {accountId, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut, amountIn: quote.swapIn, minOut: route.minOut});

  const balanceIn = await fetchNearTokenBalance(quote.tokenIn, accountId, view);
  if (balanceIn < quote.payUnits) throw new NearTradeError(quote.side === 'buy' ? 'Not enough USDC on NEAR for this trade.' : "You don't hold that much of this token.");
  // A new NEAR account only exists once Mango's relayer has set it up
  // (with starter NEAR for storage) — do that before counting its NEAR.
  await ensureAccount(session, {rpc});
  const needNear = attachedNear(route.txs);
  if (needNear > 0n && needNear > (await spendableNear(accountId, rpc))) {
    throw new NearTradeError("Your NEAR account doesn't have enough NEAR to register this token (a one-time storage deposit).");
  }

  const sent = await send(session, route.txs);
  const verdict = classifySwapOutcomes(route.txs, sent);
  const fee = feeAfterSwap(quote, verdict.status, usedAmount(sent, route.txs));
  let feeError: string | null = null;
  let feeCharged = 0n;
  const hashes = [...verdict.hashes];
  if (fee > 0n) {
    try {
      const registration = await storageRegistration(NEAR_USDC, DEV_FEE_WALLET_NEAR, view);
      const call = feeTransaction({token: NEAR_USDC, fee, feeAccount: DEV_FEE_WALLET_NEAR, feeRegistration: registration});
      if (call) {
        const [feeOutcome] = await send(session, [call]);
        if (feeOutcome?.hash) hashes.push(feeOutcome.hash);
        if (feeOutcome?.result && 'Failure' in feeOutcome.result) throw new Error("The fee transfer didn't go through.");
        feeCharged = fee;
      }
    } catch (err) {
      feeError = err instanceof Error ? err.message : "Mango's fee couldn't be sent.";
    }
  }
  return {status: verdict.status, hashes, feeCharged, feeError};
}

export {IntearRouteError, NearSendError};
