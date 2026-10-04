// src/core/crossChainQuote.ts
//
// 0x Cross-Chain fallback used only when Relay cannot produce a direct
// source -> destination-token route. The API key stays behind Mango's
// server proxy. This module is quote/status transport only; signing is
// handled by executeCrossChainQuote.ts after the same intent checks used
// by the existing Relay path.

import type {ChainKey} from './chainData.ts';

const QUOTE_URL = 'https://mangoprotocol.site/api/v1/bridge/cross-chain-quote';
const STATUS_URL = 'https://mangoprotocol.site/api/v1/bridge/cross-chain-status';

export type CrossChainTransaction =
  | {
      chainType: 'evm';
      details: {to: string; data?: string; value?: string; gas?: string};
    }
  | {
      chainType: 'svm';
      details: {serializedTransaction: string};
    };

export type CrossChainQuote = {
  liquidityAvailable: boolean;
  originChainId: number;
  originChain: string;
  destinationChainId: number;
  destinationChain: string;
  sellToken: string;
  buyToken: string;
  allowanceTarget: string | null;
  issues: {
    allowance: {actual?: string; spender?: string} | null;
    simulationIncomplete: boolean;
  };
  quote: {
    sellAmount: string;
    buyAmount: string;
    minBuyAmount: string;
    quoteId: string;
    fees: {
      integratorFee?: {amount?: string; token?: string} | null;
      integratorFees?: Array<{amount?: string; token?: string}> | null;
      bridgeNativeFee?: {amount?: string; token?: string; type?: string} | null;
    } | null;
    gasCosts: Record<string, unknown> | null;
    steps: Array<Record<string, unknown>>;
    transaction: CrossChainTransaction;
    estimatedTimeSeconds: number | null;
  };
};

export type CrossChainStatus = {
  status: string | null;
  bridge: string | null;
  transactions: Array<{chainId?: number; chain?: string; txHash?: string; timestamp?: number}>;
  failure: {status?: string; reason?: string; recovery?: Record<string, unknown>} | null;
  steps: Array<Record<string, unknown>>;
};

function apiError(json: unknown, fallback: string): Error {
  const message = json && typeof json === 'object' && 'error' in json && typeof (json as {error?: unknown}).error === 'string'
    ? (json as {error: string}).error
    : fallback;
  return new Error(message);
}

export async function getCrossChainQuote(params: {
  originChainKey: ChainKey;
  destinationChainKey: ChainKey;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  originAddress: string;
  recipientAddress: string;
  slippageBps?: string;
}): Promise<CrossChainQuote> {
  const body = {
    originChain: String(params.originChainKey === 'solana' ? 'solana' : chainIdFor(params.originChainKey)),
    destinationChain: String(params.destinationChainKey === 'solana' ? 'solana' : chainIdFor(params.destinationChainKey)),
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmount,
    originAddress: params.originAddress,
    recipient: params.recipientAddress,
    slippageBps: params.slippageBps,
  };
  const res = await fetch(QUOTE_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({} as {data?: unknown; error?: unknown}));
  if (!res.ok || !json?.data) throw apiError(json, 'No safe cross-chain route is available right now.');
  return json.data as CrossChainQuote;
}

export async function getCrossChainStatus(params: {
  originChainKey: ChainKey;
  originTxHash: string;
  quoteId: string;
}): Promise<CrossChainStatus> {
  const q = new URLSearchParams({
    originChain: params.originChainKey === 'solana' ? 'solana' : String(chainIdFor(params.originChainKey)),
    originTxHash: params.originTxHash,
    quoteId: params.quoteId,
  });
  const res = await fetch(`${STATUS_URL}?${q.toString()}`);
  const json = await res.json().catch(() => ({} as {data?: unknown; error?: unknown}));
  if (!res.ok || !json?.data) throw apiError(json, 'Could not check cross-chain execution status.');
  return json.data as CrossChainStatus;
}

function chainIdFor(chainKey: ChainKey): number {
  switch (chainKey) {
    case 'ethereum': return 1;
    case 'base': return 8453;
    case 'bnb': return 56;
    case 'robinhood': return 4663;
    case 'stable': return 988;
    case 'arbitrum': return 42161;
    case 'avalanche': return 43114;
    case 'abstract': return 2741;
    case 'hyperevm': return 999;
    case 'ink': return 57073;
    case 'plasma': return 9745;
    case 'unichain': return 130;
    case 'xlayer': return 196;
    case 'arc': return 5042;
    case 'solana': return 999999999991;
  }
}
