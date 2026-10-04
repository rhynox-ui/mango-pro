// src/wallet/relayGaslessWithdrawal.ts
//
// Relay-backed EIP-7702 gasless EVM withdrawal fallback.
// This is deliberately isolated from the existing DEX/Relay trade execution
// paths: a Pimlico rejection can fall back here without changing quote routing
// or Uniswap fallback behavior.
//
// Flow:
// 1. Request a same-chain Relay quote for the exact cash token + recipient.
// 2. Require the quote to return enough output for the exact requested amount.
// 3. Run Mango's existing quote intent firewall against every quote step.
// 4. Delegate the user's EOA to Relay's Calibur batch executor with EIP-7702.
// 5. Sign the quote steps atomically with Calibur's EIP-712 batch signature.
// 6. Submit the signed batch through Mango's server-side Relay proxy.
// 7. Poll Relay status before reporting success.
//
// Relay API keys never enter the APK.

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  pad,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {getRelayQuote, intentForQuote, type RelayQuote, type RelayTransactionStepItem} from '../core/relayQuote.ts';
import type {ChainKey} from '../core/chainData.ts';
import {assertQuoteSafeToSign} from '../core/txIntentFirewall.ts';
import {transportFor} from '../core/chainRegistry.ts';

const RELAY_EXECUTE_PROXY_URL = 'https://mangoprotocol.site/api/v1/pro/relay-execute';
const RELAY_STATUS_URL = 'https://api.relay.link/intents/status/v3';
const CALIBUR_ADDRESS = '0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00' as Address;
const ROOT_KEY_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;
const ORIGIN_GAS_OVERHEAD = 80_000;

const CALIBUR_ABI = [
  {
    name: 'execute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'signedBatchedCall',
        type: 'tuple',
        components: [
          {
            name: 'batchedCall',
            type: 'tuple',
            components: [
              {
                name: 'calls',
                type: 'tuple[]',
                components: [
                  {name: 'to', type: 'address'},
                  {name: 'value', type: 'uint256'},
                  {name: 'data', type: 'bytes'},
                ],
              },
              {name: 'revertOnFailure', type: 'bool'},
            ],
          },
          {name: 'nonce', type: 'uint256'},
          {name: 'keyHash', type: 'bytes32'},
          {name: 'executor', type: 'address'},
          {name: 'deadline', type: 'uint256'},
        ],
      },
      {name: 'wrappedSignature', type: 'bytes'},
    ],
    outputs: [],
  },
] as const;

const CALIBUR_EIP712_TYPES = {
  SignedBatchedCall: [
    {name: 'batchedCall', type: 'BatchedCall'},
    {name: 'nonce', type: 'uint256'},
    {name: 'keyHash', type: 'bytes32'},
    {name: 'executor', type: 'address'},
    {name: 'deadline', type: 'uint256'},
  ],
  BatchedCall: [
    {name: 'calls', type: 'Call[]'},
    {name: 'revertOnFailure', type: 'bool'},
  ],
  Call: [
    {name: 'to', type: 'address'},
    {name: 'value', type: 'uint256'},
    {name: 'data', type: 'bytes'},
  ],
} as const;

type RelayExecuteResponse = {requestId?: string; error?: string; message?: string};

function pendingItems(quote: RelayQuote): RelayTransactionStepItem[] {
  const items: RelayTransactionStepItem[] = [];
  for (const step of quote.steps ?? []) {
    if (step.kind !== 'transaction') {
      throw new Error(`Unsupported Relay withdrawal step "${step.kind}".`);
    }
    for (const item of step.items) {
      if (item.status !== 'complete') items.push(item);
    }
  }
  if (items.length === 0) throw new Error('Relay returned no transaction step for this withdrawal.');
  return items;
}

async function postRelayExecute(body: Record<string, unknown>): Promise<RelayExecuteResponse> {
  const res = await fetch(RELAY_EXECUTE_PROXY_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: RelayExecuteResponse = {};
  try { parsed = JSON.parse(text) as RelayExecuteResponse; } catch {}
  if (!res.ok) {
    throw new Error(parsed.message || parsed.error || `Relay gasless execution failed (${res.status}).`);
  }
  if (!parsed.requestId) throw new Error('Relay accepted the request without a requestId.');
  return parsed;
}

async function pollRelayStatus(requestId: string): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    const res = await fetch(`${RELAY_STATUS_URL}?requestId=${encodeURIComponent(requestId)}`);
    if (res.ok) {
      const body = await res.json() as {status?: string; message?: string};
      if (body.status === 'success') return (body as {txHashes?: string[]}).txHashes?.[0] || requestId;
      if (body.status === 'failure' || body.status === 'refund') {
        throw new Error(body.message || `Relay reported withdrawal status: ${body.status}.`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Relay gasless withdrawal timed out. The request was already submitted; check Relay status before retrying.');
}

/**
 * Attempts a fully gasless same-chain EVM cash withdrawal.
 * Throws before any Relay submission when the quote cannot deliver the exact
 * requested amount. Callers may then safely use their existing plain path.
 */
export async function sendEvmCashAssetViaRelayGasless(params: {
  chain: Chain;
  chainKey: ChainKey;
  tokenAddress: Address;
  fromAddress: Address;
  toAddress: Address;
  amountRaw: bigint;
  privateKey: Hex;
}): Promise<{hash: string}> {
  const {chain, chainKey, tokenAddress, fromAddress, toAddress, amountRaw, privateKey} = params;
  if (amountRaw <= 0n) throw new Error('Withdrawal amount must be greater than zero.');

  const quote = await getRelayQuote({
    fromChainKey: chainKey,
    toChainKey: chainKey,
    originCurrency: tokenAddress,
    destinationCurrency: tokenAddress,
    amountBaseUnits: amountRaw.toString(),
    userAddress: fromAddress,
    recipientAddress: toAddress,
    waiveAppFee: true,
  });

  const outputAmount = quote.details?.currencyOut?.amount;
  if (!outputAmount || !/^\d+$/.test(outputAmount) || BigInt(outputAmount) < amountRaw) {
    throw new Error('Relay cannot deliver the full requested withdrawal amount gaslessly.');
  }

  const tagged = intentForQuote(quote);
  if (!tagged) throw new Error('Relay withdrawal quote has no recorded security intent.');
  const items = pendingItems(quote);
  const warnings = assertQuoteSafeToSign(quote, tagged.intent, items);
  for (const warning of warnings) console.warn(`[relayGaslessWithdrawal] ${warning}`);

  const publicClient = createPublicClient({chain, transport: transportFor(chain.id)});
  const owner = privateKeyToAccount(privateKey);
  if (owner.address.toLowerCase() !== fromAddress.toLowerCase()) {
    throw new Error('Relay withdrawal signer does not match the selected wallet.');
  }
  const walletClient = createWalletClient({account: owner, chain, transport: transportFor(chain.id)});

  const calls = items.map(item => {
    const data = item.data ?? {};
    if (!data.to) throw new Error('Relay returned a withdrawal step without a destination.');
    if (data.chainId !== undefined && Number(data.chainId) !== chain.id) {
      throw new Error('Relay returned a withdrawal step for the wrong chain.');
    }
    return {
      to: data.to as Address,
      value: data.value ? BigInt(data.value) : 0n,
      data: (data.data || '0x') as Hex,
    };
  });

  const code = await publicClient.getCode({address: fromAddress});
  const alreadyCaliburDelegated =
    code?.toLowerCase() === `0xef0100${CALIBUR_ADDRESS.slice(2).toLowerCase()}`;

  let authorization: {
    chainId: number;
    address: Address;
    nonce: number;
    yParity: number;
    r: Hex;
    s: Hex;
  } | undefined;

  if (!alreadyCaliburDelegated) {
    const nonce = await publicClient.getTransactionCount({address: fromAddress});
    const signed = await walletClient.signAuthorization({
      contractAddress: CALIBUR_ADDRESS,
      chainId: chain.id,
      nonce,
    });
    authorization = {
      chainId: Number(signed.chainId),
      address: signed.address,
      nonce: signed.nonce,
      yParity: signed.yParity ?? 0,
      r: signed.r,
      s: signed.s,
    };
  }

  let caliburNonce = 0n;
  if (alreadyCaliburDelegated) {
    const seq = await publicClient.readContract({
      address: fromAddress,
      abi: [
        {
          name: 'getSeq',
          type: 'function',
          stateMutability: 'view',
          inputs: [{name: 'key', type: 'uint256'}],
          outputs: [{name: '', type: 'uint256'}],
        },
      ] as const,
      functionName: 'getSeq',
      args: [0n],
    });
    caliburNonce = BigInt(seq);
  }

  const signedBatchedCall = {
    batchedCall: {calls, revertOnFailure: true},
    nonce: caliburNonce,
    keyHash: ROOT_KEY_HASH,
    executor: '0x0000000000000000000000000000000000000000' as Address,
    deadline: 0n,
  };

  const signature = await walletClient.signTypedData({
    domain: {
      name: 'Calibur',
      version: '1.0.0',
      chainId: BigInt(chain.id),
      verifyingContract: fromAddress,
      salt: pad(CALIBUR_ADDRESS, {dir: 'left', size: 32}),
    },
    types: CALIBUR_EIP712_TYPES,
    primaryType: 'SignedBatchedCall',
    message: signedBatchedCall,
  });

  const wrappedSignature = encodeAbiParameters(
    [{type: 'bytes'}, {type: 'bytes'}],
    [signature, '0x'],
  );

  const batchData = encodeFunctionData({
    abi: CALIBUR_ABI,
    functionName: 'execute',
    args: [signedBatchedCall, wrappedSignature],
  });

  const execute = await postRelayExecute({
    requestId: quote.steps?.find(step => step.requestId)?.requestId,
    executionKind: 'rawCalls',
    data: {
      chainId: chain.id,
      to: fromAddress,
      data: batchData,
      value: '0',
      ...(authorization ? {authorizationList: [authorization]} : {}),
    },
    executionOptions: {
      subsidizeFees: true,
    },
  });

  const hash = await pollRelayStatus(execute.requestId!);
  return {hash};
}
