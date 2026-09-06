// src/core/relayQuote.ts
//
// Ported from mango-mobile's own src/bridge/relayBridge.js — same Relay
// Protocol request/response shape, same retry policy, hitting Relay's
// public API directly (https://api.relay.link) rather than the site's
// own backend proxy: mobile has no "same origin" server to route
// through the way the website does, and Mango Pro is in exactly the
// same position, so this follows mobile's pattern, not the site's.
//
// Every quote is tagged with the intent it was requested under (see
// quoteIntents below) — src/core/executeRelayQuote.ts reads this to run
// the pre-sign firewall before signing anything. This is the same
// pattern mango-bridge.jsx's own relaybridge.js uses: intent is built
// from the REQUEST body, never read back out of the response, or the
// check would be circular and worthless.
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
import {buildTransactionIntent, type TransactionIntent} from './txIntentFirewall.ts';

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
  /** Basis-points string ("50" = 0.5%), or omit entirely for Auto — Relay's own front-running-aware default. Never a client-side guess: when set, this is the literal bound Relay quotes against and the number shown back in details.slippageTolerance.total. */
  slippageTolerance?: string;
};

/** One transaction Relay needs signed — EVM-shaped (to/data/value/chainId) or Solana-shaped (instructions), per executeRelayQuote.ts's own dispatch. */
export type RelayTransactionStepItem = {
  status?: string;
  data?: {
    chainId?: number;
    to?: string;
    data?: string;
    value?: string;
    instructions?: {keys: {pubkey: string; isSigner: boolean; isWritable: boolean}[]; programId: string; data: string}[];
    addressLookupTableAddresses?: string[];
  };
};
export type RelayStep = {kind: string; requestId?: string; items: RelayTransactionStepItem[]};

/** Raw Relay quote response — typed only for the fields this app actually reads, not the full schema. */
export type RelayQuote = {
  fees?: {
    gas?: {amountUsd?: string | number};
    relayer?: {amountUsd?: string | number};
    relayerService?: {amountUsd?: string | number};
    app?: {amountUsd?: string | number};
  };
  details?: {
    timeEstimate?: string | number;
    // Both currencyIn/currencyOut also carry `currency.chainId`/
    // `currency.address` and (currencyIn) `amount` — real fields on
    // Relay's own response, read by txIntentFirewall.ts's pre-sign
    // checks rather than by summarizeQuote() below, but typed here too
    // so this one type stays the single source of truth for what a
    // quote object actually looks like, instead of two independently
    // hand-typed subsets of the same response drifting apart.
    currencyIn?: {amount?: string; amountUsd?: string | number; currency?: {chainId?: number; address?: string}};
    currencyOut?: {
      amount?: string;
      amountFormatted?: string;
      amountUsd?: string | number;
      currency?: {chainId?: number; address?: string; decimals?: number};
    };
    recipient?: string;
    swapImpact?: {percent?: string | number};
    totalImpact?: {percent?: string | number};
    slippageTolerance?: {total?: string | number};
  };
  steps?: RelayStep[];
};

/**
 * Keyed on the quote object's own identity, not a property written onto
 * it — nothing that serializes, logs, or clones the quote carries the
 * intent with it, and a quote object that didn't come from
 * getRelayQuote() has no entry here at all, which executeRelayQuote.ts
 * treats as a refusal to sign rather than as permission.
 */
const quoteIntents = new WeakMap<object, {intent: TransactionIntent; quotedAt: number}>();

/** Reads back the intent+timestamp getRelayQuote() tagged this exact quote object with — undefined for any quote not obtained from getRelayQuote(). */
export function intentForQuote(quote: RelayQuote): {intent: TransactionIntent; quotedAt: number} | undefined {
  return quoteIntents.get(quote);
}

export async function getRelayQuote(params: GetRelayQuoteParams): Promise<RelayQuote> {
  const {fromChainKey, toChainKey, fromAsset, toAsset, originCurrency, destinationCurrency, amountBaseUnits, userAddress, recipientAddress, originAmountUsd, sponsoringGasOutright, slippageTolerance} = params;

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
    // Additive only — omitted entirely on Auto, same as
    // mango-mobile's own relayBridge.js, so leaving slippage on Auto
    // is a real "field not sent" rather than a client-guessed default.
    ...(slippageTolerance ? {slippageTolerance} : {}),
  };

  const res = await postRelayQuote(body);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Relay quote failed (${res.status}): ${text || res.statusText}`);
  }
  const quote = (await res.json()) as RelayQuote;

  // Built from `body` — what was actually asked for — never from the
  // response; reading intent back out of the answer would make the
  // firewall check circular. quotedAt rides in the same entry so
  // executeRelayQuote.ts can refuse a stale quote's gas/rate numbers
  // without a second, separate tagging mechanism.
  if (quote && typeof quote === 'object') {
    quoteIntents.set(quote, {
      intent: buildTransactionIntent({
        originChainId: body.originChainId,
        destinationChainId: body.destinationChainId,
        originCurrency: body.originCurrency,
        destinationCurrency: body.destinationCurrency,
        amountBaseUnits: body.amount,
        userAddress: body.user,
        recipientAddress: body.recipient,
      }),
      quotedAt: Date.now(),
    });
  }

  return quote;
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
