// src/core/relayQuote.ts
//
// Ported from mango-mobile's own src/bridge/relayBridge.js — same Relay
// Protocol request/response shape, same retry policy, hitting Relay's
// public API directly (https://api.relay.link) rather than the site's
// own backend proxy: mobile has no "same origin" server to route
// through the way the website does, and Mango Pro is in exactly the
// same position, so this follows mobile's pattern, not the site's.
//
// Quote-only for now — no executeRelayQuote here yet. Signing/
// broadcasting needs the intent-firewall + calldata-decode confirm
// screen (build plan §5), which hasn't been ported into this app yet;
// wiring a "You receive" estimate doesn't require any of that, so it's
// a safe, real increment on its own.
//
// Fee: every request attaches appFeeBpsForSponsoredTrade() with
// sponsoringGasOutright left false — Mango Pro's wallet today is a
// plain EOA signing its own transactions (the smart-account/paymaster
// layer is still gated on the Phase 0 provider spike), so there is no
// sponsored gas cost yet for the chain-aware floor to protect against.
// That floor activates the moment gas sponsorship goes live, not before
// — wiring `sponsoringGasOutright: true` here today would inflate fees
// for a cost the protocol isn't actually paying.

import {formatUnits} from 'viem';
import {currencyAddress, MAINNET_CHAIN_IDS, type ChainKey} from './chainData.ts';
import {appFeeBpsForSponsoredTrade, feeRecipientForQuote} from './fees.ts';

const RELAY_QUOTE_URL = 'https://api.relay.link/quote/v2';

const RELAY_QUOTE_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RELAY_QUOTE_MAX_ATTEMPTS = 4;
const RELAY_QUOTE_BACKOFF_MS = 500;

async function postRelayQuote(body: Record<string, unknown>): Promise<Response> {
  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt < RELAY_QUOTE_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(RELAY_QUOTE_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastNetworkError = err;
      if (attempt === RELAY_QUOTE_MAX_ATTEMPTS - 1) throw err;
      await new Promise(r => setTimeout(r, RELAY_QUOTE_BACKOFF_MS * 2 ** attempt));
      continue;
    }
    if (res.ok || !RELAY_QUOTE_RETRYABLE_STATUS.has(res.status) || attempt === RELAY_QUOTE_MAX_ATTEMPTS - 1) {
      return res;
    }
    await new Promise(r => setTimeout(r, RELAY_QUOTE_BACKOFF_MS * 2 ** attempt));
  }
  throw lastNetworkError ?? new Error('Relay quote request failed without a response.');
}

export type GetRelayQuoteParams = {
  fromChainKey: ChainKey;
  toChainKey: ChainKey;
  /** Origin currency address — pass directly for a token not in chainData.ts's verified list (any arbitrary searched token); omit to resolve fromAsset via currencyAddress(). */
  originCurrency?: string;
  /** Symbol to resolve via currencyAddress() when originCurrency isn't passed directly. */
  fromAsset?: string;
  /** Destination currency address — pass directly for a token not in chainData.ts's verified list; omit to resolve toAsset via currencyAddress(). */
  destinationCurrency?: string;
  toAsset?: string;
  amountBaseUnits: string;
  userAddress: string;
  recipientAddress?: string;
  originAmountUsd?: number | null;
  sponsoringGasOutright?: boolean;
};

/** Raw Relay quote response — typed only for the fields summarizeQuote() actually reads, not the full schema. */
export type RelayQuote = {
  fees?: {
    gas?: {amountUsd?: string | number};
    relayer?: {amountUsd?: string | number};
    relayerService?: {amountUsd?: string | number};
    app?: {amountUsd?: string | number};
  };
  details?: {
    timeEstimate?: string | number;
    currencyIn?: {amountUsd?: string | number};
    currencyOut?: {
      amount?: string;
      amountFormatted?: string;
      amountUsd?: string | number;
      currency?: {decimals?: number};
    };
    swapImpact?: {percent?: string | number};
    totalImpact?: {percent?: string | number};
    slippageTolerance?: {total?: string | number};
  };
};

export async function getRelayQuote(params: GetRelayQuoteParams): Promise<RelayQuote> {
  const {fromChainKey, toChainKey, fromAsset, toAsset, originCurrency, destinationCurrency, amountBaseUnits, userAddress, recipientAddress, originAmountUsd, sponsoringGasOutright} = params;

  const resolvedOriginCurrency = originCurrency ?? (fromAsset ? currencyAddress(fromChainKey, fromAsset) : undefined);
  const resolvedDestinationCurrency = destinationCurrency ?? (toAsset ? currencyAddress(toChainKey, toAsset) : undefined);
  if (!resolvedOriginCurrency || !resolvedDestinationCurrency) {
    throw new Error('getRelayQuote requires either an explicit currency address or a resolvable asset symbol for both sides.');
  }

  const body = {
    user: userAddress,
    recipient: recipientAddress || userAddress,
    originChainId: MAINNET_CHAIN_IDS[fromChainKey],
    destinationChainId: MAINNET_CHAIN_IDS[toChainKey],
    originCurrency: resolvedOriginCurrency,
    destinationCurrency: resolvedDestinationCurrency,
    amount: amountBaseUnits,
    tradeType: 'EXACT_INPUT',
    appFees: [{recipient: feeRecipientForQuote(), fee: appFeeBpsForSponsoredTrade(fromChainKey, originAmountUsd, {sponsoringGasOutright})}],
  };

  const res = await postRelayQuote(body);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Relay quote failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as RelayQuote;
}

export type QuoteSummary = {
  totalFeeUsd: number | null;
  etaSeconds: number | null;
  receivedAmountFormatted: string | null;
  payAmountUsd: number | null;
  receiveAmountUsd: number | null;
  priceImpactPct: number | null;
};

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Same field-name mapping as mango-mobile's DexScreen.tsx summarizeQuote
 * — confirmed there directly against @relayprotocol/relay-sdk's
 * generated api.d.ts. `fallbackDecimals` is only used if Relay's own
 * response omits currency.decimals on the destination side, which in
 * practice it doesn't for a genuine route.
 */
export function summarizeQuote(quote: RelayQuote, fallbackDecimals: number): QuoteSummary {
  const fees = quote?.fees ?? {};
  const details = quote?.details ?? {};

  const sourceGasUsd = num(fees?.gas?.amountUsd);
  const relayerUsd = num(fees?.relayer?.amountUsd);
  const relayerServiceUsd = num(fees?.relayerService?.amountUsd);
  const relayerTotalUsd = relayerUsd ?? relayerServiceUsd;
  const appUsd = num(fees?.app?.amountUsd);
  const feeParts = [sourceGasUsd, relayerTotalUsd, appUsd].filter((v): v is number => v !== null);
  const totalFeeUsd = feeParts.length > 0 ? feeParts.reduce((a, b) => a + b, 0) : null;

  const etaSeconds = num(details?.timeEstimate);

  const currencyOut = details?.currencyOut;
  let receivedAmountFormatted: string | null = null;
  if (currencyOut?.amountFormatted) {
    receivedAmountFormatted = String(currencyOut.amountFormatted);
  } else if (currencyOut?.amount) {
    try {
      receivedAmountFormatted = formatUnits(BigInt(currencyOut.amount), currencyOut?.currency?.decimals ?? fallbackDecimals);
    } catch {
      receivedAmountFormatted = null;
    }
  }

  const payAmountUsd = num(details?.currencyIn?.amountUsd);
  const receiveAmountUsd = num(details?.currencyOut?.amountUsd);
  const priceImpactPct = num(details?.swapImpact?.percent ?? details?.totalImpact?.percent);

  return {totalFeeUsd, etaSeconds, receivedAmountFormatted, payAmountUsd, receiveAmountUsd, priceImpactPct};
}
