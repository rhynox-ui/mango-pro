// src/core/fallbackDex.ts
//
// Second-source same-chain swap execution — tried only when Relay itself
// has no route at all. Scoped port of mango-mobile's own
// src/bridge/fallbackDex.js: that file tries eight providers (four
// direct on-chain DEX routers — Uniswap V3/V4, SushiSwap V2, PancakeSwap
// V3 — plus four generic quote-proxy aggregators). This now carries over
// six of those eight: all four direct on-chain routers (their own real
// body of pool-key-derivation and Permit2 code lives in this app's own
// uniswapV3.ts/uniswapV4.ts/sushiswapV2.ts/pancakeswapV3.ts, ported
// faithfully rather than re-derived) plus the two generic providers that
// need no developer-account verification, 1inch and 0x. Still not
// ported: OKX and KyberSwap, mobile's other two generic providers — OKX
// needs a real account this app doesn't hold, and KyberSwap's own
// integration there was only ever verified against public docs, not a
// live account either; both stay a real, disclosed gap rather than
// guessed into working.
//
// Priority order matches mobile's own (uniswapV3.js's own header
// explains the reasoning in full): uniswap-v4 and uniswap-v3 first — no
// backend/API-key dependency at all, so neither can fail from a
// third-party outage or a bad key, and both are Robinhood Chain's real,
// primary liquidity. sushiswap-v2 and pancakeswap-v3 right after, same
// no-key shape. 1inch/0x last, since they're the ones with a real
// third-party dependency (their own API, proxied through the backend
// below).
//
// Quoting for 1inch/0x goes through mango-bridge.jsx's own backend proxy
// — same reason mobile's version does: both require a real developer
// API key in the request header, and a key shipped inside a decompilable
// mobile APK isn't a secret at all. This app holds none of its own; the
// site's server does. Same endpoint, provider names, and request/response
// shape mobile already uses in production — not a new integration to
// stand up, a client reusing one that already exists. The four on-chain
// providers need no such proxy at all — they call public, permissionless
// contracts directly, same as any other DeFi client.
//
// Approve-then-swap, not Relay's own self-executed appFees model: selling
// anything but the chain's native asset needs a real ERC-20 approve() to
// the provider's own router first (allowanceTarget from the quote) —
// skipped for a native sell (allowanceTarget is null then). Approves
// EXACTLY the amount this one swap needs, never an unlimited allowance —
// same reasoning mobile's own header gives (a rare fallback path, not a
// repeated integration, so there's no UX case for a standing approval).
//
// One real hardening beyond the mobile source, since this app already
// holds itself to a higher bar elsewhere (txIntentFirewall.ts,
// solanaTxIntent.ts): the swap transaction's to/data/value come directly
// from a third-party API relayed through the backend proxy and mobile's
// own executeFallbackQuote signs them with no pre-flight check at all.
// This version adds the same publicClient.call() simulate
// executeRelayQuote.ts's own sendRelayEvmStep already runs before every
// Relay-sourced transaction, plus a bound on the native value leaving
// the wallet — cheap, real protection against a malformed or hostile
// quote, not present in the source this was ported from.
//
// sweepFallbackFeeFromNativeBalance below closes the one gap flagged
// when this file was first written: mobile's own
// settleFallbackFeeFromNativeBalance sweeps Mango's fee separately when
// the winning provider didn't collect it inline (0x doesn't; 1inch's own
// Integrator Fee does) — that depended on a live native-asset USD price
// feed this app didn't have yet. walletPrices.ts now exists (same
// CoinGecko source mobile's own walletPrices.js uses), so this is ported
// too, same best-effort/fire-and-forget contract as the source: called
// AFTER a fallback trade has already succeeded, never blocks or affects
// it, and silently does nothing if the price, balance, or gas-reserve
// estimate isn't available.

import {createPublicClient, createWalletClient, formatUnits, parseEther} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {getViemChain, transportFor} from './chainRegistry.ts';
import {MAINNET_CHAIN_IDS, NATIVE_SYMBOL, type ChainKey} from './chainData.ts';
import {DEV_FEE_MAX_USD, DEV_FEE_PCT, DEV_FEE_WALLET, appFeeBps} from './fees.ts';
import {fetchWalletPrices} from './walletPrices.ts';
import {estimateEvmNativeFeeReserve, fetchWalletNativeBalance} from '../wallet/walletRpc.ts';
import {formatAmountForInput} from '../wallet/useAvailableBalance.ts';
import {executeUniswapV4Swap, quoteUniswapV4, uniswapV4SupportsChain} from './uniswapV4.ts';
import {executeUniswapV3Swap, quoteUniswapV3, uniswapV3SupportsChain} from './uniswapV3.ts';
import {executeSushiSwapV2Swap, quoteSushiSwapV2, sushiswapV2SupportsChain} from './sushiswapV2.ts';
import {executePancakeSwapV3Swap, quotePancakeSwapV3, pancakeswapV3SupportsChain} from './pancakeswapV3.ts';

const FALLBACK_QUOTE_URL = 'https://mangoprotocol.site/api/v1/bridge/fallback-quote';

export const FALLBACK_PROVIDERS = ['uniswap-v4', 'uniswap-v3', 'sushiswap-v2', 'pancakeswap-v3', '1inch', '0x'] as const;
export type FallbackProvider = (typeof FALLBACK_PROVIDERS)[number];
type GenericFallbackProvider = '1inch' | '0x';

type RawFallbackQuote = {
  to: string;
  data: string;
  value?: string;
  gas?: string;
  allowanceTarget?: string | null;
  sellAmount?: string;
  buyAmount: string;
  feeCollectedInline?: boolean;
};

const ERC20_ALLOWANCE_ABI = [
  {type: 'function', name: 'allowance', inputs: [{name: 'owner', type: 'address'}, {name: 'spender', type: 'address'}], outputs: [{type: 'uint256'}], stateMutability: 'view'},
  {type: 'function', name: 'approve', inputs: [{name: 'spender', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}], stateMutability: 'nonpayable'},
] as const;

function chainIdFor(chainKey: ChainKey): number {
  const chainId = MAINNET_CHAIN_IDS[chainKey];
  if (!chainId) throw new Error(`No fallback route support for ${chainKey} — this path only covers EVM chains.`);
  return chainId;
}

async function fetchFallbackQuote({
  provider,
  chainId,
  sellToken,
  buyToken,
  sellAmount,
  takerAddress,
  originAmountUsd,
}: {
  provider: GenericFallbackProvider;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  takerAddress: string;
  originAmountUsd?: number | null;
}): Promise<RawFallbackQuote> {
  // Same appFeeBps() every other quote path already uses — the backend
  // proxy forwards this rate as-is, converting to whatever unit each
  // provider's own API expects (see fallback-quote.js, mango-bridge.jsx).
  const feeBps = appFeeBps(originAmountUsd);
  const res = await fetch(FALLBACK_QUOTE_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({provider, chainId, sellToken, buyToken, sellAmount, takerAddress, feeBps, feeWallet: DEV_FEE_WALLET}),
  });
  const json = (await res.json().catch(() => ({}))) as {error?: string; data?: RawFallbackQuote};
  if (!res.ok || !json.data) {
    throw new Error(json?.error || `${provider} fallback quote failed (${res.status}).`);
  }
  return json.data;
}

/** Same real bug fix mobile's own header documents: a technically-real but functionally-worthless quote (a stale/near-empty pool) rounds to zero once formatted — treated as no quote at all, not a route. */
function quoteRoundsToZero(amountOut: bigint, buyDecimals: number | null | undefined): boolean {
  if (buyDecimals == null) return false;
  try {
    return Number(Number(formatUnits(amountOut, buyDecimals)).toFixed(4)) === 0;
  } catch {
    return false;
  }
}

// The on-chain providers' own quote shape carries what execution needs
// to replay the exact same pool/fee found at quote time, never
// re-deriving it (and possibly landing on a different pool) at execute
// time. sushiswap-v2 needs nothing extra — it has exactly one pool per
// pair, no fee tier or pool-key concept at all.
type OnchainExecData =
  | {kind: 'uniswap-v4'; poolKey: {currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}`}; zeroForOne: boolean}
  | {kind: 'uniswap-v3'; fee: number}
  | {kind: 'sushiswap-v2'}
  | {kind: 'pancakeswap-v3'; fee: number};

type ProviderEntry = {provider: FallbackProvider; buyAmount: bigint} & ({kind: 'onchain'; execData: OnchainExecData} | {kind: 'generic'; quote: RawFallbackQuote});

/**
 * Quotes every provider in parallel and ranks by real output — never
 * the first to answer, same real bug fix mobile's own header documents
 * (a worse-priced provider answering first used to lock in that price).
 * The four on-chain providers (see this file's own header for their
 * priority-order reasoning) are queried directly against their own
 * public contracts; the two generic ones (1inch/0x) go through the
 * backend quote proxy.
 */
async function quoteAllProviders({
  chainId,
  sellToken,
  buyToken,
  sellAmount,
  takerAddress,
  originAmountUsd,
  buyDecimals,
}: {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  takerAddress: string;
  originAmountUsd?: number | null;
  buyDecimals?: number | null;
}): Promise<{entries: ProviderEntry[]; failures: string[]}> {
  const sellAmountBig = BigInt(sellAmount);

  const attempts = FALLBACK_PROVIDERS.map(async (provider): Promise<ProviderEntry | null> => {
    if (provider === 'uniswap-v4') {
      if (!uniswapV4SupportsChain(chainId)) return null;
      const best = await quoteUniswapV4({chainId, tokenIn: sellToken, tokenOut: buyToken, amountIn: sellAmountBig});
      if (!best || quoteRoundsToZero(best.amountOut, buyDecimals)) return null;
      return {provider, kind: 'onchain', buyAmount: best.amountOut, execData: {kind: 'uniswap-v4', poolKey: best.poolKey, zeroForOne: best.zeroForOne}};
    }
    if (provider === 'uniswap-v3') {
      if (!uniswapV3SupportsChain(chainId)) return null;
      const best = await quoteUniswapV3({chainId, tokenIn: sellToken, tokenOut: buyToken, amountIn: sellAmountBig});
      if (!best || quoteRoundsToZero(best.amountOut, buyDecimals)) return null;
      return {provider, kind: 'onchain', buyAmount: best.amountOut, execData: {kind: 'uniswap-v3', fee: best.fee}};
    }
    if (provider === 'sushiswap-v2') {
      if (!sushiswapV2SupportsChain(chainId)) return null;
      const best = await quoteSushiSwapV2({chainId, tokenIn: sellToken, tokenOut: buyToken, amountIn: sellAmountBig});
      if (!best || quoteRoundsToZero(best.amountOut, buyDecimals)) return null;
      return {provider, kind: 'onchain', buyAmount: best.amountOut, execData: {kind: 'sushiswap-v2'}};
    }
    if (provider === 'pancakeswap-v3') {
      if (!pancakeswapV3SupportsChain(chainId)) return null;
      const best = await quotePancakeSwapV3({chainId, tokenIn: sellToken, tokenOut: buyToken, amountIn: sellAmountBig});
      if (!best || quoteRoundsToZero(best.amountOut, buyDecimals)) return null;
      return {provider, kind: 'onchain', buyAmount: best.amountOut, execData: {kind: 'pancakeswap-v3', fee: best.fee}};
    }
    const quote = await fetchFallbackQuote({provider, chainId, sellToken, buyToken, sellAmount, takerAddress, originAmountUsd});
    const buyAmount = BigInt(quote.buyAmount ?? '0');
    if (quoteRoundsToZero(buyAmount, buyDecimals)) return null;
    return {provider, kind: 'generic', buyAmount, quote};
  });

  const settled = await Promise.allSettled(attempts);
  const entries: ProviderEntry[] = [];
  const failures: string[] = [];
  settled.forEach((result, i) => {
    const provider = FALLBACK_PROVIDERS[i];
    if (result.status === 'fulfilled' && result.value) {
      entries.push(result.value);
    } else if (result.status === 'rejected') {
      failures.push(`${provider}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  });
  entries.sort((a, b) => (b.buyAmount > a.buyAmount ? 1 : b.buyAmount < a.buyAmount ? -1 : 0));
  return {entries, failures};
}

export type FallbackRouteParams = {
  chainKey: ChainKey;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  takerAddress: string;
  originAmountUsd?: number | null;
  buyDecimals?: number | null;
};

/**
 * Quote-only preview — the real gap this closes, same as mobile's own
 * checkFallbackRoute: without it, a token Relay hasn't indexed shows a
 * blank "—" receive amount right up to the moment a trade is attempted,
 * even though a fallback provider could actually quote and execute it.
 * null means neither provider can quote this pair, never a guess.
 */
export async function checkFallbackRoute(params: FallbackRouteParams): Promise<{provider: FallbackProvider; buyAmount: string} | null> {
  if (params.chainKey === 'solana') return null;
  const {entries} = await quoteAllProviders({chainId: chainIdFor(params.chainKey), ...params});
  if (entries.length === 0) return null;
  const winner = entries[0];
  return {provider: winner.provider, buyAmount: winner.buyAmount.toString()};
}

function clientsForChain(chainKey: ChainKey, privateKeyHex: string) {
  const chain = getViemChain(chainKey);
  const transport = transportFor(chain.id);
  const account = privateKeyToAccount(privateKeyHex as `0x${string}`);
  return {
    walletClient: createWalletClient({account, chain, transport}),
    publicClient: createPublicClient({chain, transport}),
  };
}

async function executeFallbackQuote({
  chainKey,
  privateKeyHex,
  sellTokenAddress,
  sellAmount,
  quote,
}: {
  chainKey: ChainKey;
  privateKeyHex: string;
  sellTokenAddress: string;
  sellAmount: string;
  quote: RawFallbackQuote;
}): Promise<{hash: string}> {
  const {walletClient, publicClient} = clientsForChain(chainKey, privateKeyHex);
  const account = walletClient.account;
  if (!account) throw new Error('No signer account on this wallet client.');

  if (quote.allowanceTarget) {
    const currentAllowance = (await publicClient.readContract({
      address: sellTokenAddress as `0x${string}`,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [account.address, quote.allowanceTarget as `0x${string}`],
    })) as bigint;
    const requiredAmount = BigInt(quote.sellAmount ?? sellAmount ?? '0');
    if (currentAllowance < requiredAmount) {
      const approveHash = await walletClient.writeContract({
        address: sellTokenAddress as `0x${string}`,
        abi: ERC20_ALLOWANCE_ABI,
        functionName: 'approve',
        args: [quote.allowanceTarget as `0x${string}`, requiredAmount],
      });
      await publicClient.waitForTransactionReceipt({hash: approveHash});
    }
  }

  const value = BigInt(quote.value ?? '0');
  // Real bound, not present in the mobile source this was ported from:
  // the native value this transaction spends should never exceed the
  // amount actually being sold (a native-asset sell) — a quote asking
  // to send materially more native value than the trade itself is a
  // sign of a malformed or hostile response, not a real swap.
  if (!sellTokenAddress || sellTokenAddress === '0x0000000000000000000000000000000000000000') {
    const sellAmountBig = BigInt(sellAmount);
    if (value > sellAmountBig) {
      throw new Error('This fallback quote asks to send more native value than the trade itself — refusing to sign.');
    }
  }

  const tx = {account, to: quote.to as `0x${string}`, data: quote.data as `0x${string}`, value};
  try {
    await publicClient.call(tx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message && !/timeout|network|fetch|429|403/i.test(message)) {
      throw new Error(`This fallback transaction would revert: ${message}`);
    }
  }

  const swapHash = await walletClient.sendTransaction({...tx, ...(quote.gas ? {gas: BigInt(quote.gas)} : {})});
  await publicClient.waitForTransactionReceipt({hash: swapHash});
  return {hash: swapHash};
}

export type FallbackExecuteParams = FallbackRouteParams & {privateKeyHex: string};
export type FallbackExecuteResult = {provider: FallbackProvider; hash: string; buyAmount: string; feeCollectedInline: boolean};

// 1% — same default tolerance applied wherever nothing more specific is
// available (no caller here passes a user-chosen slippage preset
// through to the on-chain fallback path). Protects the swap from
// landing far worse than quoted between the quote call and the swap
// call below, without being so tight a normal price move between those
// two calls fails it.
const UNISWAP_SLIPPAGE_BPS = 100n;

/**
 * Quotes every provider (see quoteAllProviders above), then executes
 * against whichever gave the best price, falling through to the
 * next-best only if that execution itself fails. Throws once all of
 * them have failed, carrying every provider's own failure reason — the
 * caller's own catch already has the ORIGINAL Relay error to show
 * instead, since this only ever runs after that one failed first (see
 * TokenTradeScreen.tsx's own call site).
 */
export async function tryFallbackProviders(params: FallbackExecuteParams): Promise<FallbackExecuteResult> {
  if (params.chainKey === 'solana') {
    throw new Error('No fallback route support for Solana — this path only covers EVM chains.');
  }
  const chainId = chainIdFor(params.chainKey);
  const {entries, failures} = await quoteAllProviders({chainId, ...params});
  const sellAmountBig = BigInt(params.sellAmount);

  // Real bug fix, ported from mobile's own header: uniswap-v4/uniswap-v3/
  // sushiswap-v2/pancakeswap-v3 each spend their own on-chain approval
  // before the swap itself (v4 and pancakeswap-v3 even spend two, via
  // their own separate Permit2 deployments). If the best-priced
  // provider's quote succeeded and execution then throws, the approval
  // transaction very likely already landed — falling through to the
  // NEXT on-chain provider would spend yet another approval on top of
  // that. Once that's happened, skip the remaining on-chain providers
  // entirely and fall straight through to the generic aggregators
  // (1inch/0x), which aren't part of this approval cascade.
  let onchainApprovalSpent = false;

  for (const entry of entries) {
    if (entry.kind === 'onchain' && onchainApprovalSpent) continue;
    try {
      if (entry.kind === 'onchain') {
        const minAmountOut = entry.buyAmount - (entry.buyAmount * UNISWAP_SLIPPAGE_BPS) / 10000n;
        onchainApprovalSpent = true;
        // No inline fee collection on any of these four — none has a
        // fee mechanism built in — so all of them rely on
        // TokenTradeScreen.tsx's own post-success
        // sweepFallbackFeeFromNativeBalance call, same as a fallback
        // trade landing on 0x already does.
        if (entry.execData.kind === 'uniswap-v4') {
          const result = await executeUniswapV4Swap({chainId, privateKeyHex: params.privateKeyHex, tokenIn: params.sellToken, tokenOut: params.buyToken, amountIn: sellAmountBig, poolKey: entry.execData.poolKey, zeroForOne: entry.execData.zeroForOne, minAmountOut});
          return {provider: entry.provider, hash: result.hash, buyAmount: entry.buyAmount.toString(), feeCollectedInline: false};
        }
        if (entry.execData.kind === 'uniswap-v3') {
          const result = await executeUniswapV3Swap({chainId, privateKeyHex: params.privateKeyHex, tokenIn: params.sellToken, tokenOut: params.buyToken, amountIn: sellAmountBig, fee: entry.execData.fee, minAmountOut});
          return {provider: entry.provider, hash: result.hash, buyAmount: entry.buyAmount.toString(), feeCollectedInline: false};
        }
        if (entry.execData.kind === 'sushiswap-v2') {
          const result = await executeSushiSwapV2Swap({chainId, privateKeyHex: params.privateKeyHex, tokenIn: params.sellToken, tokenOut: params.buyToken, amountIn: sellAmountBig, minAmountOut});
          return {provider: entry.provider, hash: result.hash, buyAmount: entry.buyAmount.toString(), feeCollectedInline: false};
        }
        const result = await executePancakeSwapV3Swap({chainId, privateKeyHex: params.privateKeyHex, tokenIn: params.sellToken, tokenOut: params.buyToken, amountIn: sellAmountBig, fee: entry.execData.fee, minAmountOut});
        return {provider: entry.provider, hash: result.hash, buyAmount: entry.buyAmount.toString(), feeCollectedInline: false};
      }
      // Generic provider (1inch/0x) — quote was already fetched by
      // quoteAllProviders above, re-executed against as-is.
      const result = await executeFallbackQuote({
        chainKey: params.chainKey,
        privateKeyHex: params.privateKeyHex,
        sellTokenAddress: params.sellToken,
        sellAmount: params.sellAmount,
        quote: {...entry.quote, sellAmount: params.sellAmount},
      });
      return {provider: entry.provider, hash: result.hash, buyAmount: entry.quote.buyAmount, feeCollectedInline: !!entry.quote.feeCollectedInline};
    } catch (err) {
      failures.push(`${entry.provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`No fallback route available. ${failures.join(' | ')}`);
}

// Dust floor — under this, the gas cost of a second, separate
// transaction would rival or exceed the fee itself, not worth sending.
// Same value mobile's own MIN_FALLBACK_FEE_USD uses.
const MIN_FALLBACK_FEE_USD = 0.05;

/**
 * Best-effort, fire-and-forget: collects Mango's fee separately when a
 * fallback trade landed on a provider that didn't collect it inline (0x
 * doesn't; 1inch's own Integrator Fee does — see TokenTradeScreen.tsx's
 * own call site, which only calls this when feeCollectedInline is
 * false). The swap has ALREADY succeeded by the time this ever runs, so
 * a failure or a deliberate skip here never affects it or gets shown to
 * the user. Sized off the same appFeeBps math every other quote path
 * uses, converted into the chain's own native currency via a live
 * price — skipped entirely, never billed at a guessed number, if that
 * price or a large-enough spare native balance (beyond a real gas
 * reserve for transacting again) isn't actually known.
 */
export async function sweepFallbackFeeFromNativeBalance({
  chainKey,
  evmAddress,
  privateKeyHex,
  originAmountUsd,
}: {
  chainKey: ChainKey;
  evmAddress: string;
  privateKeyHex: string;
  originAmountUsd: number | undefined | null;
}): Promise<void> {
  if (!(originAmountUsd && originAmountUsd > 0)) return;
  const targetFeeUsd = Math.min(originAmountUsd * DEV_FEE_PCT, DEV_FEE_MAX_USD);
  if (!(targetFeeUsd >= MIN_FALLBACK_FEE_USD)) return;

  const nativeSymbol = NATIVE_SYMBOL[chainKey];
  const prices = await fetchWalletPrices('usd').catch(() => null);
  const nativePriceUsd = prices?.[nativeSymbol];
  if (!(nativePriceUsd && nativePriceUsd > 0)) return;
  const targetFeeNative = targetFeeUsd / nativePriceUsd;

  const freshBalance = await fetchWalletNativeBalance(chainKey, evmAddress).catch(() => null);
  if (freshBalance === null) return;
  const gasReserve = await estimateEvmNativeFeeReserve(chainKey).catch(() => 0);
  // Doubled for the same reason DexScreen.tsx's own handleMax doubles
  // it: this transfer is itself a second transaction after the swap, so
  // it needs its own gas headroom kept aside too, never eating into what
  // the user needs to transact again.
  const spareNative = freshBalance - gasReserve * 2;
  const feeToSend = Math.min(targetFeeNative, spareNative);
  if (!(feeToSend > 0)) return;

  const {walletClient, publicClient} = clientsForChain(chainKey, privateKeyHex);
  const account = walletClient.account;
  if (!account) return;
  const hash = await walletClient.sendTransaction({account, to: DEV_FEE_WALLET as `0x${string}`, value: parseEther(formatAmountForInput(feeToSend))});
  await publicClient.waitForTransactionReceipt({hash});
}
