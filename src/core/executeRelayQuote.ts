// src/core/executeRelayQuote.ts
//
// Turns a getRelayQuote() result into signed, broadcast transactions —
// the piece relayQuote.ts's own earlier header named as the blocker on
// real trading, and the reason src/core/txIntentFirewall.ts and
// solanaTxIntent.ts were ported first. Direct-broadcast, same confirmed
// architecture as the rest of this app's wallet code (sendUsdc.ts):
// this device signs with the session's own key and submits straight to
// each chain, no backend in between.
//
// Two references combined, neither ported alone:
// - mango-bridge.jsx's own src/relaybridge.js for HOW the firewall gets
//   wired into execution: read the intent tagged onto the quote object
//   (relayQuote.ts's own intentForQuote()), run assertQuoteSafeToSign
//   against every still-pending item BEFORE signing the first one, log
//   (never swallow) any warnings, THEN sign step by step.
// - mango-mobile's own src/bridge/relayBridge.js for the actual signing
//   mechanics, since the site signs through wagmi/an external wallet
//   and this app IS the wallet: sendRelayEvmStep's pre-flight simulate
//   + native-balance check (a clear "insufficient ETH for gas" instead
//   of a wallet just failing), and signAndSendRelaySolanaStep's hardened
//   retry (insufficient-lamports detection, and a skipPreflight retry +
//   landed-check for the well-documented case where a public RPC's own
//   stale simulation snapshot rejects a transaction that the real
//   cluster accepts a moment later).
//
// Solana's WSOL-unwrap edge case from mango-mobile's version is NOT
// ported: this app requests Solana's native-SOL identifier, never WSOL,
// so there's nothing left to unwrap (see mobile's own long comment on
// why that fix made the whole cleanup path unnecessary going forward).

import {createPublicClient, createWalletClient} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {CHAIN_KEY_TO_VIEM_CHAIN, transportFor} from './chainRegistry.ts';
import {assertQuoteSafeToSign} from './txIntentFirewall.ts';
import {intentForQuote, type RelayQuote, type RelayTransactionStepItem} from './relayQuote.ts';
import type {DerivedAccounts} from '../wallet/keys';

const RELAY_STATUS_URL = 'https://api.relay.link/intents/status/v3';
const SOLANA_RPC_URL = 'https://rpc.solanatracker.io/public';

// A quote's gas/rate numbers are only fresh for a short window — this is
// this app's own client-side clock (relayQuote.ts's quotedAt tag), not a
// field Relay's response schema documents itself.
const RELAY_QUOTE_MAX_AGE_MS = 2 * 60 * 1000;

export type ExecuteStep = 'build' | 'signing' | 'filling' | 'done';

function isSolanaShaped(item: RelayTransactionStepItem): boolean {
  return Boolean(item.data?.instructions);
}

/** Relay steps carry a numeric EIP-155 chainId, not this app's own ChainKey — resolved against the same viem Chain table chainRegistry.ts already builds. */
function viemChainForChainId(chainId: number) {
  return Object.values(CHAIN_KEY_TO_VIEM_CHAIN).find(chain => chain?.id === chainId);
}

async function pollRelayStatus(requestId: string, {intervalMs = 2000, timeoutMs = 10 * 60 * 1000}: {intervalMs?: number; timeoutMs?: number} = {}): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${RELAY_STATUS_URL}?requestId=${requestId}`);
    if (res.ok) {
      const data = (await res.json()) as {status?: string};
      if (data.status === 'success') return;
      if (data.status === 'failure') throw new Error("Relay reported this trade failed — check the requestId on relay.link for details.");
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for Relay to confirm completion. Your transaction was broadcast — check status manually using the requestId before retrying.');
}

/**
 * Sends one EVM-side Relay step. Simulates first (publicClient.call) so
 * a route that would revert on-chain fails with a real, readable reason
 * instead of burning gas to find out; then checks the native balance
 * actually covers value + worst-case gas cost before broadcasting.
 */
async function sendRelayEvmStep(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  item: RelayTransactionStepItem,
): Promise<string> {
  const {to, data, value} = item.data ?? {};
  if (!to) throw new Error('The routing service returned a transaction with no destination address.');
  const account = walletClient.account;
  if (!account) throw new Error('No signer account on this wallet client.');
  const tx = {account, to: to as `0x${string}`, data: (data || undefined) as `0x${string}` | undefined, value: value ? BigInt(value) : 0n};

  try {
    await publicClient.call(tx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Only surface this as a real revert when the simulation itself ran
    // and rejected the call — a transport-level hiccup isn't evidence
    // the real transaction would fail.
    if (message && !/timeout|network|fetch|429|403/i.test(message)) {
      throw new Error(`This transaction would revert: ${message}`);
    }
  }

  let gas: bigint;
  let maxFeePerGas: bigint;
  let maxPriorityFeePerGas: bigint;
  let nativeBalance: bigint;
  try {
    const [gasEstimate, fees, balance] = await Promise.all([publicClient.estimateGas(tx), publicClient.estimateFeesPerGas(), publicClient.getBalance({address: account.address})]);
    gas = gasEstimate;
    maxFeePerGas = fees.maxFeePerGas;
    maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? fees.maxFeePerGas;
    nativeBalance = balance;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/gas required exceeds allowance|insufficient funds/i.test(message)) {
      const symbol = walletClient.chain?.nativeCurrency?.symbol || 'the native coin';
      throw new Error(`Insufficient ${symbol} for network fees. A token balance can't pay for gas — you need ${symbol} on this chain too.`);
    }
    throw err;
  }
  const worstCaseCost = tx.value + gas * maxFeePerGas;
  if (nativeBalance < worstCaseCost) {
    const symbol = walletClient.chain?.nativeCurrency?.symbol || 'the native coin';
    throw new Error(`Insufficient ${symbol} for network fees. A token balance can't pay for gas — you need ${symbol} on this chain too.`);
  }

  const hash = await walletClient.sendTransaction({account, to: tx.to, data: tx.data, value: tx.value, gas, maxFeePerGas, maxPriorityFeePerGas, chain: walletClient.chain});
  await publicClient.waitForTransactionReceipt({hash});
  return hash;
}

/**
 * Signs and sends one Solana-side Relay step, with the two hardened
 * fallbacks mango-mobile's own relayBridge.js added after live
 * failures: a clear "insufficient SOL" message when the preflight
 * simulation says so, and a skipPreflight retry (falling back to a
 * direct landed-check) for the well-documented case where a public
 * RPC's own simulation snapshot lags the real cluster by a moment.
 */
async function signAndSendRelaySolanaStep(item: RelayTransactionStepItem, secretKeyBase58: string): Promise<string> {
  const [{Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction}, bs58Module] = await Promise.all([import('@solana/web3.js'), import('bs58')]);
  const bs58 = bs58Module.default;
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  const keypair = Keypair.fromSecretKey(bs58.decode(secretKeyBase58));

  const instructions = (item.data?.instructions ?? []).map(
    ix =>
      new TransactionInstruction({
        keys: ix.keys.map(k => ({pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable})),
        programId: new PublicKey(ix.programId),
        data: Buffer.from(ix.data, 'hex'),
      }),
  );
  const lookupTables = (
    await Promise.all((item.data?.addressLookupTableAddresses ?? []).map(addr => connection.getAddressLookupTable(new PublicKey(addr)).then(res => res.value)))
  ).filter((t): t is NonNullable<typeof t> => Boolean(t));

  const {blockhash} = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({payerKey: keypair.publicKey, instructions, recentBlockhash: blockhash}).compileToV0Message(lookupTables);
  const transaction = new VersionedTransaction(message);
  transaction.sign([keypair]);
  const signature = bs58.encode(transaction.signatures[0]);

  async function confirmOrTagError(): Promise<string> {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const {value} = await connection.getSignatureStatuses([signature]);
      const status = value?.[0];
      if (status) {
        if (status.err) {
          const error = new Error(`Transaction ${signature} failed on-chain: ${JSON.stringify(status.err)}`);
          (error as {signature?: string}).signature = signature;
          throw error;
        }
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return signature;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for transaction ${signature} to confirm.`);
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  try {
    await connection.sendRawTransaction(transaction.serialize());
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const lamportsMatch = errorMessage.match(/insufficient lamports (\d+), need (\d+)/i);
    if (lamportsMatch) {
      const haveSol = Number(lamportsMatch[1]) / 1e9;
      const needSol = Number(lamportsMatch[2]) / 1e9;
      throw new Error(`This route needs ~${needSol.toFixed(4)} SOL for network fees/rent, but this wallet only has ~${haveSol.toFixed(4)} SOL. Add more SOL and try again.`);
    }
    try {
      await connection.sendRawTransaction(transaction.serialize(), {skipPreflight: true});
      return await confirmOrTagError();
    } catch {
      // The retry itself failed to submit — fall through to a direct
      // landed-check rather than trusting the simulation's rejection.
    }
    let landed = false;
    for (let attempt = 0; attempt < 3 && !landed; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 700));
      const {value} = await connection.getSignatureStatuses([signature]).catch(() => ({value: [null]}));
      const status = value?.[0];
      if (status && status.err == null && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) landed = true;
    }
    if (!landed) {
      (err as {signature?: string}).signature = signature;
      throw err;
    }
  }
  return confirmOrTagError();
}

export type ExecuteRelayQuoteResult = {txHashes: string[]; warnings: string[]};

/**
 * Executes a quote from getRelayQuote(): checks the pre-sign firewall
 * against every still-pending item BEFORE signing the first one (so a
 * quote whose LAST transaction is the hostile one is refused before the
 * first is broadcast), then signs and sends each pending item with the
 * session's own key, then polls Relay until the destination side is
 * reported complete. Throws TransactionIntentError (from
 * txIntentFirewall.ts) if the firewall blocks; throws a plain Error for
 * anything else (network, insufficient balance, on-chain revert).
 */
export async function executeRelayQuote(quote: RelayQuote, session: DerivedAccounts, onStep?: (step: ExecuteStep) => void): Promise<ExecuteRelayQuoteResult> {
  const tagged = intentForQuote(quote);
  if (!tagged) {
    throw new Error('This quote has no recorded intent to check against — refusing to sign.');
  }
  if (Date.now() - tagged.quotedAt > RELAY_QUOTE_MAX_AGE_MS) {
    throw new Error('This quote is too old to sign safely — get a fresh quote and try again.');
  }

  onStep?.('build');
  const steps = quote.steps ?? [];
  const pendingItems: RelayTransactionStepItem[] = [];
  let requestId: string | undefined;
  for (const step of steps) {
    if (step.kind !== 'transaction') {
      throw new Error(`Unsupported Relay step kind "${step.kind}" — only transaction steps are handled by this app.`);
    }
    requestId = requestId ?? step.requestId;
    for (const item of step.items) {
      if (item.status !== 'complete') pendingItems.push(item);
    }
  }

  const warnings = assertQuoteSafeToSign(quote, tagged.intent, pendingItems);
  for (const warning of warnings) {
    console.warn(`[txIntentFirewall] ${warning}`);
  }

  onStep?.('signing');
  const txHashes: string[] = [];
  let evmClients: {walletClient: ReturnType<typeof createWalletClient>; publicClient: ReturnType<typeof createPublicClient>} | null = null;

  for (const item of pendingItems) {
    if (isSolanaShaped(item)) {
      const signature = await signAndSendRelaySolanaStep(item, session.solana.privateKey);
      txHashes.push(signature);
      continue;
    }
    const chainId = item.data?.chainId;
    if (!chainId) throw new Error('The routing service returned a transaction with no chain.');
    if (!evmClients || evmClients.publicClient.chain?.id !== chainId) {
      const viemChain = viemChainForChainId(chainId);
      if (!viemChain) throw new Error(`No EVM chain configured for chain id ${chainId}.`);
      const account = privateKeyToAccount(session.evm.privateKey as `0x${string}`);
      const transport = transportFor(chainId);
      evmClients = {
        walletClient: createWalletClient({account, chain: viemChain, transport}),
        publicClient: createPublicClient({chain: viemChain, transport}),
      };
    }
    const hash = await sendRelayEvmStep(evmClients.walletClient, evmClients.publicClient, item);
    txHashes.push(hash);
  }

  if (requestId) {
    onStep?.('filling');
    await pollRelayStatus(requestId);
  }
  onStep?.('done');
  return {txHashes, warnings};
}
