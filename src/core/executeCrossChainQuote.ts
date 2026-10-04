// src/core/executeCrossChainQuote.ts
//
// Executes a 0x Cross-Chain quote from the wallet itself. The API key stays
// server-side. The origin transaction is checked against the exact user
// intent before approval/signing, then 0x status is polled until the bridge
// is filled or a terminal recovery state is reached.

import {signerAndPublicClientForChain, writeContractAs, sendTransactionAs} from './evmSigner.ts';
import {assertTransactionItemsMatchIntent, buildTransactionIntent, type RelayTransactionItem} from './txIntentFirewall.ts';
import {assertSolanaTransactionMatchesIntent} from './solanaTxIntent.ts';
import {assertSolanaSpendWithinIntentWeb3, type SolanaSpendIntent} from './solanaSpendGuard.ts';
import {getCrossChainStatus, type CrossChainQuote} from './crossChainQuote.ts';
import {MAINNET_CHAIN_IDS, type ChainKey} from './chainData.ts';
import type {DerivedAccounts} from '../wallet/keys';

const ERC20_ALLOWANCE_ABI = [
  {type: 'function', name: 'allowance', inputs: [{name: 'owner', type: 'address'}, {name: 'spender', type: 'address'}], outputs: [{type: 'uint256'}], stateMutability: 'view'},
] as const;
const ERC20_APPROVE_ABI = [
  {type: 'function', name: 'approve', inputs: [{name: 'spender', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}], stateMutability: 'nonpayable'},
] as const;

const SOLANA_NATIVE = '11111111111111111111111111111111';
const SOLANA_CHAIN_ID = 999999999991;

type CrossChainStep = 'build' | 'signing' | 'filling' | 'done';

export type ExecuteCrossChainResult = {
  txHashes: string[];
  warnings: string[];
  status: string;
};

function chainIdFor(chainKey: ChainKey): number {
  return MAINNET_CHAIN_IDS[chainKey];
}

function isNative0xToken(token: string): boolean {
  const normalized = token.toLowerCase();
  return normalized === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    || normalized === '0x0000000000000000000000000000000000000000'
    || token === SOLANA_NATIVE;
}

function assertQuoteEnvelope(
  quote: CrossChainQuote,
  expected: {
    originChainKey: ChainKey;
    destinationChainKey: ChainKey;
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    recipientAddress: string;
  },
): void {
  if (quote.originChainId !== chainIdFor(expected.originChainKey)) throw new Error('Cross-chain quote origin does not match the wallet source chain.');
  if (quote.destinationChainId !== chainIdFor(expected.destinationChainKey)) throw new Error('Cross-chain quote destination does not match the selected token chain.');
  if (quote.sellToken.toLowerCase() !== expected.sellToken.toLowerCase()) throw new Error('Cross-chain quote would spend a different token than requested.');
  if (quote.buyToken.toLowerCase() !== expected.buyToken.toLowerCase()) throw new Error('Cross-chain quote would deliver a different token than requested.');
  if (quote.quote.sellAmount !== expected.sellAmount) throw new Error('Cross-chain quote amount changed before signing.');
  if (!quote.quote.quoteId) throw new Error('Cross-chain quote has no quoteId.');
  if (BigInt(quote.quote.minBuyAmount || '0') <= 0n) throw new Error('Cross-chain quote returned no protected minimum output.');
  void expected.recipientAddress;
}

function evmItemFromQuote(quote: CrossChainQuote): RelayTransactionItem {
  if (quote.quote.transaction.chainType !== 'evm') throw new Error('Expected an EVM-origin transaction.');
  const details = quote.quote.transaction.details;
  return {data: {chainId: quote.originChainId, to: details.to, data: details.data, value: details.value ?? '0'}};
}

function encodeApprove(spender: string, amount: bigint): string {
  const paddedSpender = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const paddedAmount = amount.toString(16).padStart(64, '0');
  return '0x095ea7b3' + paddedSpender + paddedAmount;
}

async function executeEvmOrigin(
  quote: CrossChainQuote,
  session: DerivedAccounts,
  expected: Parameters<typeof assertQuoteEnvelope>[1],
): Promise<{hash: string; warnings: string[]}> {
  const {signer, publicClient} = signerAndPublicClientForChain(quote.originChainId, session);
  const owner = signer.address;
  const intent = buildTransactionIntent({
    originChainId: quote.originChainId,
    destinationChainId: quote.destinationChainId,
    originCurrency: quote.sellToken,
    destinationCurrency: quote.buyToken,
    amountBaseUnits: quote.quote.sellAmount,
    userAddress: owner,
    recipientAddress: expected.recipientAddress,
  });

  const item = evmItemFromQuote(quote);
  const allowanceIssue = quote.issues.allowance;
  const approvalSpender = allowanceIssue?.spender ?? quote.allowanceTarget ?? null;
  let approvalNeeded = false;

  if (approvalSpender && !isNative0xToken(quote.sellToken)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(approvalSpender)) throw new Error('Cross-chain quote returned an invalid allowance spender.');
    const currentAllowance = await publicClient.readContract({
      address: quote.sellToken as any,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [owner, approvalSpender as any],
    }) as bigint;
    approvalNeeded = currentAllowance < BigInt(quote.quote.sellAmount);
  }

  const items: RelayTransactionItem[] = [];
  if (approvalNeeded) {
    items.push({
      data: {
        chainId: quote.originChainId,
        to: quote.sellToken,
        data: encodeApprove(approvalSpender!, BigInt(quote.quote.sellAmount)),
        value: '0',
      },
    });
  }
  items.push(item);
  const warnings = assertTransactionItemsMatchIntent(items, intent);

  if (quote.quote.transaction.chainType !== 'evm') throw new Error('Expected an EVM-origin transaction.');
  const tx = quote.quote.transaction.details;
  const nativeValue = BigInt(tx.value ?? '0');
  if (!isNative0xToken(quote.sellToken)) {
    const bridgeNativeFee = BigInt(quote.quote.fees?.bridgeNativeFee?.amount ?? '0');
    if (nativeValue > bridgeNativeFee) throw new Error('Cross-chain quote asks for more native value than its declared bridge fee. Refusing to sign.');
  }

  if (approvalNeeded) {
    const approveHash = await writeContractAs(signer, {
      address: quote.sellToken as any,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [approvalSpender as any, BigInt(quote.quote.sellAmount)],
    });
    await publicClient.waitForTransactionReceipt({hash: approveHash});
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(tx.to)) throw new Error('Cross-chain transaction has no valid destination contract.');

  try {
    await publicClient.call({
      account: owner,
      to: tx.to as any,
      data: tx.data as any,
      value: nativeValue,
    });
  } catch (err) {
    throw new Error('Cross-chain transaction failed pre-sign simulation: ' + (err instanceof Error ? err.message.split('\n')[0] : String(err)));
  }

  const hash = await sendTransactionAs(signer, {
    to: tx.to as any,
    data: tx.data as any,
    value: nativeValue,
    gas: tx.gas ? BigInt(tx.gas) : undefined,
  });
  return {hash, warnings};
}

async function executeSolanaOrigin(
  quote: CrossChainQuote,
  session: DerivedAccounts,
): Promise<{hash: string; warnings: string[]}> {
  if (quote.quote.transaction.chainType !== 'svm') throw new Error('Expected a Solana-origin transaction.');
  const [{Connection, Keypair, VersionedTransaction}, bs58Module] = await Promise.all([
    import('@solana/web3.js'),
    import('bs58'),
  ]);
  const bs58 = bs58Module.default;
  const connection = new Connection('https://rpc.solanatracker.io/public', 'confirmed');
  const raw = Buffer.from(quote.quote.transaction.details.serializedTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(raw);

  assertSolanaTransactionMatchesIntent(transaction, {
    expectedSigner: session.solana.address,
    expectedFeePayer: session.solana.address,
  });

  const spend: SolanaSpendIntent = {
    spend: isNative0xToken(quote.sellToken) ? SOLANA_NATIVE : quote.sellToken,
    maxSpend: BigInt(quote.quote.sellAmount),
  };
  await assertSolanaSpendWithinIntentWeb3(connection, transaction, session.solana.address, spend);

  let signature: string;
  if (session.authMethod === 'google') {
    const {signAndSendSolanaTransactionViaParticle} = await import('../wallet/particleSigning.ts');
    signature = await signAndSendSolanaTransactionViaParticle(raw);
  } else {
    transaction.sign([Keypair.fromSecretKey(bs58.decode(session.solana.privateKey))]);
    signature = await connection.sendTransaction(transaction, {skipPreflight: false, preflightCommitment: 'confirmed'});
    const confirmation = await connection.confirmTransaction({
      signature,
      ...(await connection.getLatestBlockhash('confirmed')),
    }, 'confirmed');
    if (confirmation.value.err) throw new Error('Solana cross-chain transaction failed on-chain.');
  }
  return {hash: signature, warnings: []};
}

async function waitForFill(originChainKey: ChainKey, originTxHash: string, quoteId: string, timeoutMs = 10 * 60 * 1000): Promise<Awaited<ReturnType<typeof getCrossChainStatus>>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await getCrossChainStatus({originChainKey, originTxHash, quoteId});
    if (status.failure?.status === 'failed') throw new Error('0x could not recover this cross-chain route. Check History and contact 0x support with the route id if needed.');
    if (status.status === 'bridge_filled') return status;
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  throw new Error('Cross-chain bridge is still filling. The origin transaction was broadcast; check History before retrying.');
}

export async function executeCrossChainQuote(
  quote: CrossChainQuote,
  session: DerivedAccounts,
  expected: {
    originChainKey: ChainKey;
    destinationChainKey: ChainKey;
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    recipientAddress: string;
  },
  onStep?: (step: CrossChainStep) => void,
): Promise<ExecuteCrossChainResult> {
  assertQuoteEnvelope(quote, expected);
  onStep?.('build');
  if (quote.issues.simulationIncomplete) throw new Error('0x could not fully simulate this cross-chain route before signing.');

  if (expected.originChainKey === 'solana') {
    if (quote.originChainId !== SOLANA_CHAIN_ID) throw new Error('Invalid Solana origin chain in cross-chain quote.');
    onStep?.('signing');
    const result = await executeSolanaOrigin(quote, session);
    onStep?.('filling');
    const status = await waitForFill(expected.originChainKey, result.hash, quote.quote.quoteId);
    onStep?.('done');
    return {
      txHashes: [...new Set([result.hash, ...status.transactions.map(t => t.txHash).filter((h): h is string => Boolean(h))])],
      warnings: result.warnings,
      status: status.status ?? 'bridge_filled',
    };
  }

  onStep?.('signing');
  const result = await executeEvmOrigin(quote, session, expected);
  onStep?.('filling');
  const status = await waitForFill(expected.originChainKey, result.hash, quote.quote.quoteId);
  onStep?.('done');
  return {
    txHashes: [...new Set([result.hash, ...status.transactions.map(t => t.txHash).filter((h): h is string => Boolean(h))])],
    warnings: result.warnings,
    status: status.status ?? 'bridge_filled',
  };
}
