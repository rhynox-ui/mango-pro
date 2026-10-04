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
import {transportFor} from './chainRegistry.ts';

const RELAY_EXECUTE_PROXY_URL = 'https://mangoprotocol.site/api/v1/pro/relay-execute';
const RELAY_STATUS_URL = 'https://api.relay.link/intents/status/v3';
const CALIBUR_ADDRESS = '0x000000009B1D0aF20D8C6d0A44e162d11F9b8f00' as Address;
const ROOT_KEY_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

const CALIBUR_ABI = [{
  name: 'execute',
  type: 'function',
  stateMutability: 'payable',
  inputs: [{
    name: 'signedBatchedCall',
    type: 'tuple',
    components: [
      {name: 'batchedCall', type: 'tuple', components: [
        {name: 'calls', type: 'tuple[]', components: [
          {name: 'to', type: 'address'},
          {name: 'value', type: 'uint256'},
          {name: 'data', type: 'bytes'},
        ]},
        {name: 'revertOnFailure', type: 'bool'},
      ]},
      {name: 'nonce', type: 'uint256'},
      {name: 'keyHash', type: 'bytes32'},
      {name: 'executor', type: 'address'},
      {name: 'deadline', type: 'uint256'},
    ],
  }, {name: 'wrappedSignature', type: 'bytes'}],
  outputs: [],
}] as const;

const CALIBUR_EIP712_TYPES = {
  SignedBatchedCall: [
    {name: 'batchedCall', type: 'BatchedCall'},
    {name: 'nonce', type: 'uint256'},
    {name: 'keyHash', type: 'bytes32'},
    {name: 'executor', type: 'address'},
    {name: 'deadline', type: 'uint256'},
  ],
  BatchedCall: [{name: 'calls', type: 'Call[]'}, {name: 'revertOnFailure', type: 'bool'}],
  Call: [{name: 'to', type: 'address'}, {name: 'value', type: 'uint256'}, {name: 'data', type: 'bytes'}],
} as const;

type RelayExecuteResponse = {requestId?: string; error?: string; message?: string};

async function postRelayExecute(body: Record<string, unknown>): Promise<RelayExecuteResponse> {
  const res = await fetch(RELAY_EXECUTE_PROXY_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: RelayExecuteResponse = {};
  try { parsed = JSON.parse(text) as RelayExecuteResponse; } catch {}
  if (!res.ok) throw new Error(parsed.message || parsed.error || `Relay gasless execution failed (HTTP ${res.status}).`);
  if (!parsed.requestId) throw new Error('Relay accepted gasless execution without a requestId.');
  return parsed;
}

async function pollRelayStatus(requestId: string): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    const res = await fetch(`${RELAY_STATUS_URL}?requestId=${encodeURIComponent(requestId)}`);
    if (res.ok) {
      const body = await res.json() as {status?: string; message?: string; txHashes?: string[]};
      if (body.status === 'success') return body.txHashes?.[0] || requestId;
      if (body.status === 'failure' || body.status === 'refund') {
        throw new Error(body.message || `Relay gasless execution ended with status ${body.status}.`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Relay gasless execution timed out after submission; do not retry automatically.');
}

function isCaliburDelegated(code: string | undefined): boolean {
  return Boolean(code && code.toLowerCase() === `0xef0100${CALIBUR_ADDRESS.slice(2).toLowerCase()}`);
}

export async function preflightRelayGaslessEvm(params: {
  chain: Chain;
  fromAddress: Address;
  privateKey: Hex;
}): Promise<void> {
  const {chain, fromAddress, privateKey} = params;
  const publicClient = createPublicClient({chain, transport: transportFor(chain.id)});
  const owner = privateKeyToAccount(privateKey);
  if (owner.address.toLowerCase() !== fromAddress.toLowerCase()) {
    throw new Error('Relay gasless signer does not match the selected wallet.');
  }

  // Do this check BEFORE asking the user to sign anything. Calibur is the
  // implementation Mango delegates the EOA to for Relay sponsorship; if
  // that implementation is not deployed on a chain, a quote must not get
  // as far as an authorization/signature prompt only to fail afterwards.
  const caliburCode = await publicClient.getCode({address: CALIBUR_ADDRESS});
  if (!caliburCode || caliburCode === '0x') {
    throw new Error('Relay gasless execution is not available on ' + (chain.name ?? ('chain ' + chain.id)) + ' yet — no Calibur deployment was found on this chain.');
  }

  const accountCode = await publicClient.getCode({address: fromAddress});
  const delegated = isCaliburDelegated(accountCode);
  if (!delegated) {
    const walletClient = createWalletClient({account: owner, chain, transport: transportFor(chain.id)});
    if (typeof walletClient.signAuthorization !== 'function') {
      throw new Error('This wallet cannot sign the EIP-7702 authorization required for Relay gasless execution.');
    }
    return;
  }

  // A delegated account must expose the Calibur sequence state used by the
  // exact execution path below. Read it now so a stale/foreign delegation
  // is rejected before any other leg of a multi-source trade broadcasts.
  await publicClient.readContract({
    address: fromAddress,
    abi: [{name: 'getSeq', type: 'function', stateMutability: 'view', inputs: [{name: 'key', type: 'uint256'}], outputs: [{name: '', type: 'uint256'}]}] as const,
    functionName: 'getSeq',
    args: [0n],
  });
}
/**
 * Relay is Mango's sole EVM gasless executor. This function accepts the
 * already-quoted transaction calls, so the gasless path never re-quotes or
 * changes routing. A Relay rejection is terminal for this execution:
 * callers must not fall back to a native-gas transaction, because that
 * changes Mango's Fomo execution contract and can strand a user who holds
 * USDC but no ETH/BNB/other native gas token.
 */
export async function sendEvmCallsViaRelayGasless(params: {
  chain: Chain;
  fromAddress: Address;
  privateKey: Hex;
  calls: {to: Address; value: bigint; data: Hex}[];
  requestId?: string;
}): Promise<{hash: string}> {
  const {chain, fromAddress, privateKey, calls, requestId} = params;
  if (!calls.length) throw new Error('Relay gasless execution requires at least one call.');
  if (calls.some(call => call.value < 0n)) throw new Error('Invalid Relay gasless call value.');

  await preflightRelayGaslessEvm({chain, fromAddress, privateKey});

  const publicClient = createPublicClient({chain, transport: transportFor(chain.id)});
  const owner = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({account: owner, chain, transport: transportFor(chain.id)});

  const code = await publicClient.getCode({address: fromAddress});
  const alreadyCaliburDelegated = isCaliburDelegated(code);

  let authorization:
    | {chainId: number; address: Address; nonce: number; yParity: number; r: Hex; s: Hex}
    | undefined;

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
    caliburNonce = BigInt(await publicClient.readContract({
      address: fromAddress,
      abi: [{name: 'getSeq', type: 'function', stateMutability: 'view', inputs: [{name: 'key', type: 'uint256'}], outputs: [{name: '', type: 'uint256'}]}] as const,
      functionName: 'getSeq',
      args: [0n],
    }));
  }

  const signedBatchedCall = {
    batchedCall: {
      calls: calls.map(call => ({to: call.to, value: call.value, data: call.data})),
      revertOnFailure: true,
    },
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

  const wrappedSignature = encodeAbiParameters([{type: 'bytes'}, {type: 'bytes'}], [signature, '0x']);
  const batchData = encodeFunctionData({
    abi: CALIBUR_ABI,
    functionName: 'execute',
    args: [signedBatchedCall, wrappedSignature],
  });

  const response = await postRelayExecute({
    executionKind: 'rawCalls',
    userAddress: fromAddress,
    data: {
      chainId: chain.id,
      to: fromAddress,
      data: batchData,
      value: '0',
      ...(authorization ? {authorizationList: [authorization]} : {}),
    },
    executionOptions: {subsidizeFees: true},
    ...(requestId ? {requestId} : {}),
  });

  return {hash: await pollRelayStatus(response.requestId!)};
}
