import {formatUnits} from 'viem';
import {MAINNET_CHAIN_IDS, type ChainKey} from './chainData.ts';
import {appFeeBps, DEV_FEE_WALLET, isFeeExemptWallet} from './fees.ts';
import {assertTransactionItemsMatchIntent, buildTransactionIntent} from './txIntentFirewall.ts';
import {signerAndPublicClientForChain, writeContractAs} from './evmSigner.ts';
import type {DerivedAccounts} from '../wallet/keys';

const CROSS_CHAIN_0X_URL = 'https://mangoprotocol.site/api/v1/pro/0x-cross-chain';
const ERC20_ALLOWANCE_ABI = [
  {type: 'function', name: 'allowance', inputs: [{name: 'owner', type: 'address'}, {name: 'spender', type: 'address'}], outputs: [{type: 'uint256'}], stateMutability: 'view'},
  {type: 'function', name: 'approve', inputs: [{name: 'spender', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}], stateMutability: 'nonpayable'},
] as const;

export type CrossChain0xQuote = {
  liquidityAvailable: boolean;
  allowanceTarget?: string | null;
  originChainId: number;
  originChain: string;
  destinationChainId: number;
  destinationChain: string;
  sellToken: string;
  buyToken: string;
  issues?: {allowance?: {actual?: string; spender?: string} | null; balance?: unknown; simulationIncomplete?: boolean};
  quotes: Array<{
    sellAmount: string;
    buyAmount: string;
    minBuyAmount: string;
    quoteId: string;
    estimatedTimeSeconds?: number;
    fees?: {integratorFees?: unknown; zeroExFee?: unknown; bridgeNativeFee?: unknown};
    gasCosts?: {chainType?: string; totalNetworkFee?: string};
    transaction: {chainType: string; details: {to: string; data: string; value: string; gas?: string}};
    issues?: {allowance?: {actual?: string; spender?: string} | null; balance?: unknown; simulationIncomplete?: boolean};
  }>;
};

export async function getCrossChain0xQuote({
  fromChainKey,
  toChainKey,
  sellToken,
  buyToken,
  sellAmount,
  userAddress,
  destinationAddress,
  originAmountUsd,
  slippageBps,
}: {
  fromChainKey: ChainKey;
  toChainKey: ChainKey;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  userAddress: string;
  destinationAddress: string;
  originAmountUsd?: number | null;
  slippageBps?: string | null;
}): Promise<CrossChain0xQuote> {
  const originChainId = MAINNET_CHAIN_IDS[fromChainKey];
  const destinationChainId = MAINNET_CHAIN_IDS[toChainKey];
  if (!originChainId || !destinationChainId || fromChainKey === 'near' || toChainKey === 'near') {
    throw new Error('0x cross-chain routing currently requires supported EVM/Solana mainnet chains.');
  }
  if (fromChainKey === 'solana') {
    throw new Error('0x cross-chain execution currently starts from an EVM cash chain.');
  }

  const feeBps = isFeeExemptWallet(userAddress) ? 0 : appFeeBps(originAmountUsd);
  const res = await fetch(CROSS_CHAIN_0X_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      originChain: String(originChainId),
      destinationChain: String(destinationChainId),
      sellToken,
      buyToken,
      sellAmount,
      originAddress: userAddress,
      destinationAddress,
      sortQuotesBy: 'price',
      maxNumQuotes: 1,
      ...(slippageBps != null ? {slippageBps: Number(slippageBps)} : {}),
      ...(feeBps > 0 ? {feeBps, feeRecipient: DEV_FEE_WALLET, feeToken: sellToken} : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.liquidityAvailable) {
    throw new Error(body?.error || 'No safe 0x cross-chain route is available.');
  }
  const quote = body as CrossChain0xQuote;
  const best = quote.quotes?.[0];
  if (!best?.transaction?.details?.to || !best.transaction.details.data || !best.quoteId) {
    throw new Error('0x returned no executable cross-chain transaction.');
  }
  if (best.transaction.chainType !== 'evm') {
    throw new Error('0x returned a non-EVM origin transaction that Mango cannot execute from this cash source yet.');
  }
  return quote;
}

export async function executeCrossChain0xQuote({
  quote,
  fromChainKey,
  session,
  sellAmount,
  destinationChainId,
  destinationCurrency,
  recipientAddress,
  userAddress,
}: {
  quote: CrossChain0xQuote;
  fromChainKey: ChainKey;
  session: DerivedAccounts;
  sellAmount: string;
  destinationChainId: number;
  destinationCurrency: string;
  recipientAddress: string;
  userAddress: string;
}): Promise<{hash: string; quoteId: string; buyAmount: string; estimatedTimeSeconds: number}> {
  const best = quote.quotes[0];
  const tx = best.transaction.details;
  const chainId = MAINNET_CHAIN_IDS[fromChainKey];
  if (!chainId || chainId !== quote.originChainId) throw new Error('Cross-chain origin chain changed after quoting.');
  if (quote.destinationChainId !== destinationChainId || quote.buyToken.toLowerCase() !== destinationCurrency.toLowerCase()) {
    throw new Error('Cross-chain destination changed after quoting.');
  }

  const {signer, publicClient} = signerAndPublicClientForChain(chainId, session);
  const intent = buildTransactionIntent({
    originChainId: chainId,
    destinationChainId,
    originCurrency: quote.sellToken,
    destinationCurrency: quote.buyToken,
    amountBaseUnits: sellAmount,
    userAddress,
    recipientAddress,
  });

  assertTransactionItemsMatchIntent([
    {data: {chainId, to: tx.to, data: tx.data, value: tx.value}},
  ], intent);

  const allowanceSpender = best.issues?.allowance?.spender ?? quote.issues?.allowance?.spender ?? quote.allowanceTarget ?? null;
  if (allowanceSpender) {
    const allowance = await publicClient.readContract({
      address: quote.sellToken as `0x${string}`,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [signer.address, allowanceSpender as `0x${string}`],
    }) as bigint;
    const required = BigInt(best.sellAmount);
    if (allowance < required) {
      const approvalHash = await writeContractAs(signer, {
        address: quote.sellToken as `0x${string}`,
        abi: ERC20_ALLOWANCE_ABI,
        functionName: 'approve',
        args: [allowanceSpender as `0x${string}`, required],
      });
      await publicClient.waitForTransactionReceipt({hash: approvalHash});
    }
  }

  const hash = await signer.sendTransaction({
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: BigInt(tx.value || '0'),
    ...(tx.gas ? {gas: BigInt(tx.gas)} : {}),
  });
  await publicClient.waitForTransactionReceipt({hash});
  return {
    hash,
    quoteId: best.quoteId,
    buyAmount: best.buyAmount,
    estimatedTimeSeconds: best.estimatedTimeSeconds ?? 30,
  };
}

export function crossChainQuoteSummary(quote: CrossChain0xQuote, destinationDecimals: number) {
  const best = quote.quotes[0];
  return {
    receivedAmountFormatted: formatUnits(BigInt(best.buyAmount), destinationDecimals),
    receiveAmountUsd: null as number | null,
    totalFeeUsd: null as number | null,
    etaSeconds: best.estimatedTimeSeconds ?? 30,
    priceImpactPct: null as number | null,
  };
}
