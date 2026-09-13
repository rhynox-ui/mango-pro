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
import {transportFor, viemChainForChainId} from './chainRegistry.ts';
import {assertQuoteSafeToSign} from './txIntentFirewall.ts';
import {assertSolanaTransactionMatchesIntent} from './solanaTxIntent.ts';
import {intentForQuote, type RelayQuote, type RelayTransactionStepItem} from './relayQuote.ts';
import {getEip7702AuthorizationIfNeeded, getSponsoredSmartAccountClient, isSmartAccountSponsorshipConfigured} from '../wallet/smartAccount.ts';
import type {DerivedAccounts} from '../wallet/keys';

const RELAY_STATUS_URL = 'https://api.relay.link/intents/status/v3';
const SOLANA_RPC_URL = 'https://rpc.solanatracker.io/public';

// Real fix for a structural Solana gap, confirmed via real research
// (Solana's own cookbook, and how Alchemy/Privy's production wallet
// infra actually implement this) — see mango-api's own
// solana-fee-payer.js for the full reasoning and every safety check
// enforced server-side before it ever adds its signature. This app's
// own job, client-side: fetch that wallet's public key, REWRITE any
// instruction that creates AND funds a new account (verified directly
// against Solana's system_instruction.rs and the SPL Associated Token
// Account spec — never assumed) so IT funds that account instead of
// this wallet, THEN sign — in that order, so the fee payer only ever
// adds a signature to a message this wallet's own key already fixed,
// never the other way around (Relay's own docs flag the reverse order
// as exploitable for a same-chain Solana swap; Privy's own documented
// pattern is this same safer order).
const SOLANA_FEE_PAYER_URL = 'https://mangoprotocol.site/api/v1/solana/fee-payer';
const SOLANA_SPONSOR_FEE_URL = 'https://mangoprotocol.site/api/v1/solana/sponsor-fee';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
// System Program instruction discriminants (the little-endian u32 at
// the start of instruction data) for the two variants that create AND
// fund a new account in one step — verified against the real
// SystemInstruction enum's declared order, not assumed: CreateAccount
// is the 1st variant (0), CreateAccountWithSeed the 4th (3). Both put
// the funding account at account index 0, same as the Associated Token
// Account Program's Create/CreateIdempotent — confirmed against each
// spec directly rather than assumed to match by analogy.
const SYSTEM_ACCOUNT_CREATING_DISCRIMINANTS = new Set([0, 3]);

let cachedSolanaFeePayerPublicKey: string | null = null;
async function getSolanaFeePayerPublicKey(): Promise<string> {
  if (cachedSolanaFeePayerPublicKey) return cachedSolanaFeePayerPublicKey;
  const res = await fetch(SOLANA_FEE_PAYER_URL);
  if (!res.ok) throw new Error('Fee sponsorship is not available right now.');
  const {data} = (await res.json()) as {data?: {publicKey?: string}};
  if (!data?.publicKey) throw new Error('Fee sponsorship is not available right now.');
  cachedSolanaFeePayerPublicKey = data.publicKey;
  return cachedSolanaFeePayerPublicKey;
}

// A quote's gas/rate numbers are only fresh for a short window — this is
// this app's own client-side clock (relayQuote.ts's quotedAt tag), not a
// field Relay's response schema documents itself.
const RELAY_QUOTE_MAX_AGE_MS = 2 * 60 * 1000;

export type ExecuteStep = 'build' | 'signing' | 'filling' | 'done';

function isSolanaShaped(item: RelayTransactionStepItem): boolean {
  return Boolean(item.data?.instructions);
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
 * Runs the plain-transaction fallback for a sponsored EVM step that
 * couldn't go through Pimlico, and — if that fallback ALSO fails purely
 * on gas — makes the error honest about what actually happened. The user
 * turned gasless ON specifically so they wouldn't need native gas; if the
 * fallback then fails for exactly that reason, saying only "insufficient
 * ETH" (sendRelayEvmStep's own message) hides the real story: gasless was
 * tried first and rejected, THEN the fallback needed gas the wallet
 * doesn't hold by design.
 */
async function fallBackToPlainTransaction(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  item: RelayTransactionStepItem,
): Promise<string> {
  try {
    return await sendRelayEvmStep(walletClient, publicClient, item);
  } catch (fallbackErr) {
    const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    if (/insufficient .* for network fees/i.test(fallbackMessage)) {
      throw new Error(`Gasless trading isn't available for this route right now, so it fell back to a normal transaction — but ${fallbackMessage.charAt(0).toLowerCase()}${fallbackMessage.slice(1)}`);
    }
    throw fallbackErr;
  }
}

/**
 * Same shape as sendRelayEvmStep above (simulate first, check the
 * native balance actually covers value + worst-case gas, THEN send) but
 * for a Google-login session: there's no local account to build a
 * walletClient from, so the final sign+broadcast goes through
 * particleSigning.ts's Particle MPC path instead of viem's
 * walletClient.sendTransaction. Kept as a fully separate function
 * rather than threading a branch through sendRelayEvmStep itself —
 * zero risk of this new path changing behavior for the existing,
 * already-relied-on local-signing one.
 */
async function sendRelayEvmStepViaParticle(evmAddress: `0x${string}`, publicClient: ReturnType<typeof createPublicClient>, chainId: number, item: RelayTransactionStepItem): Promise<string> {
  const {to, data, value} = item.data ?? {};
  if (!to) throw new Error('The routing service returned a transaction with no destination address.');
  const tx = {to: to as `0x${string}`, data: (data || undefined) as `0x${string}` | undefined, value: value ? BigInt(value) : 0n};

  try {
    await publicClient.call({account: evmAddress, to: tx.to, data: tx.data, value: tx.value});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message && !/timeout|network|fetch|429|403/i.test(message)) {
      throw new Error(`This transaction would revert: ${message}`);
    }
  }

  let gas: bigint;
  let maxFeePerGas: bigint;
  let nativeBalance: bigint;
  try {
    const [gasEstimate, fees, balance] = await Promise.all([
      publicClient.estimateGas({account: evmAddress, to: tx.to, data: tx.data, value: tx.value}),
      publicClient.estimateFeesPerGas(),
      publicClient.getBalance({address: evmAddress}),
    ]);
    gas = gasEstimate;
    maxFeePerGas = fees.maxFeePerGas;
    nativeBalance = balance;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/gas required exceeds allowance|insufficient funds/i.test(message)) {
      const symbol = publicClient.chain?.nativeCurrency?.symbol || 'the native coin';
      throw new Error(`Insufficient ${symbol} for network fees. A token balance can't pay for gas — you need ${symbol} on this chain too.`);
    }
    throw err;
  }
  const worstCaseCost = tx.value + gas * maxFeePerGas;
  if (nativeBalance < worstCaseCost) {
    const symbol = publicClient.chain?.nativeCurrency?.symbol || 'the native coin';
    throw new Error(`Insufficient ${symbol} for network fees. A token balance can't pay for gas — you need ${symbol} on this chain too.`);
  }

  // Dynamic import, not a static one: particleSigning.ts pulls in
  // @particle-network/rn-auth-core, which touches react-native's own
  // NativeModules at module load — fine under Metro, but this file is
  // also imported directly by scripts/verify-execute-relay-quote.mjs's
  // plain-Node offline checks, which never exercises this branch.
  const {sendEvmTransactionViaParticle} = await import('../wallet/particleSigning.ts');
  const hash = await sendEvmTransactionViaParticle(evmAddress, {chainId, to: tx.to, data: tx.data, value: tx.value});
  await publicClient.waitForTransactionReceipt({hash});
  return hash;
}

/**
 * Same shape as sendRelayEvmStep above (simulate first, then broadcast)
 * but through a Pimlico-sponsored EIP-7702 smart-account client
 * (smartAccount.ts) instead of a plain wallet transaction — origin-chain
 * gas comes from Pimlico's paymaster, not this wallet's native balance,
 * so there's no balance-covers-gas check to run here at all; removing
 * that requirement is the entire point of this path (ARCHITECTURE.md
 * §1's gasless-trading opt-in).
 */
async function sendRelayEvmStepSponsored(
  client: Awaited<ReturnType<typeof getSponsoredSmartAccountClient>>,
  publicClient: ReturnType<typeof createPublicClient>,
  item: RelayTransactionStepItem,
): Promise<string> {
  const {to, data, value} = item.data ?? {};
  if (!to) throw new Error('The routing service returned a transaction with no destination address.');
  const tx = {to: to as `0x${string}`, data: (data || undefined) as `0x${string}` | undefined, value: value ? BigInt(value) : 0n};

  try {
    await publicClient.call({account: client.account.address, to: tx.to, data: tx.data, value: tx.value});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message && !/timeout|network|fetch|429|403/i.test(message)) {
      throw new Error(`This transaction would revert: ${message}`);
    }
  }

  // See smartAccount.ts's own header for the real bug this closes: the
  // installed viem's automatic path only ever attaches a STUB (fake)
  // EIP-7702 authorization, which Pimlico's bundler rejects outright —
  // a real one has to be signed and passed explicitly here.
  const authorization = await getEip7702AuthorizationIfNeeded(client, publicClient);
  const hash = await client.sendTransaction({to: tx.to, data: tx.data, value: tx.value, authorization});
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
/** Polls until a Solana signature confirms, fails on-chain, or times out — shared by the plain and sponsored signing paths below. */
async function confirmSolanaSignature(connection: InstanceType<typeof import('@solana/web3.js').Connection>, signature: string): Promise<string> {
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

/**
 * Retries a Solana step that failed for lack of native SOL by having
 * Mango's own funded wallet pay the network fee AND fund any new
 * account this route creates along the way (e.g. a temporary
 * wrapped-SOL account for a token that only pairs against SOL, never
 * USDC directly) — see this file's own header above for the full
 * reasoning and mango-api's solana-fee-payer.js for every safety check
 * enforced before that wallet ever adds its signature.
 *
 * Rewrites the funding account of any instruction that creates AND
 * funds a new account to Mango's fee-payer wallet BEFORE anyone signs,
 * then signs with this wallet's own key — locking the exact, final
 * message — and only THEN sends it to be co-signed. That order is the
 * whole safety property: the fee payer only ever adds a signature to a
 * message this wallet's own key already fixed, never the reverse.
 */
/**
 * Pure rewrite step, kept separate from any signing/network I/O so it's
 * independently testable (scripts/verify-solana-fee-sponsor.mjs) — the
 * one piece of this whole feature where getting the account index wrong
 * either breaks the transaction or silently fails to fix anything.
 * Detects any instruction that creates AND funds a new account
 * (verified directly against Solana's system_instruction.rs and the
 * SPL Associated Token Account spec, not assumed) and redirects its
 * funding account (always account index 0 for all three shapes this
 * checks) to `feePayerPubkey`. Every other instruction — including the
 * actual swap/transfer instructions carrying the user's own real
 * trade — passes through completely untouched.
 */
export function rewriteAccountCreationFundingInstructions(
  instructions: InstanceType<typeof import('@solana/web3.js').TransactionInstruction>[],
  feePayerPubkey: InstanceType<typeof import('@solana/web3.js').PublicKey>,
  TransactionInstructionCtor: typeof import('@solana/web3.js').TransactionInstruction,
): InstanceType<typeof import('@solana/web3.js').TransactionInstruction>[] {
  return instructions.map(ix => {
    const programId = ix.programId.toBase58();
    const isAssociatedTokenAccountCreate = programId === ASSOCIATED_TOKEN_PROGRAM_ID;
    const isSystemAccountCreate = programId === SYSTEM_PROGRAM_ID && ix.data.length >= 4 && SYSTEM_ACCOUNT_CREATING_DISCRIMINANTS.has(ix.data.readUInt32LE(0));
    if (!isAssociatedTokenAccountCreate && !isSystemAccountCreate) return ix;
    const keys = ix.keys.map((k, i) => (i === 0 ? {...k, pubkey: feePayerPubkey} : k));
    return new TransactionInstructionCtor({keys, programId: ix.programId, data: ix.data});
  });
}

async function signAndSendSponsoredSolanaStep(
  instructions: InstanceType<typeof import('@solana/web3.js').TransactionInstruction>[],
  lookupTables: InstanceType<typeof import('@solana/web3.js').AddressLookupTableAccount>[],
  keypair: InstanceType<typeof import('@solana/web3.js').Keypair>,
  connection: InstanceType<typeof import('@solana/web3.js').Connection>,
): Promise<{signature: string; warnings: string[]}> {
  const [{PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction}, bs58Module] = await Promise.all([import('@solana/web3.js'), import('bs58')]);
  const bs58 = bs58Module.default;
  const feePayerPubkey = new PublicKey(await getSolanaFeePayerPublicKey());
  const rewrittenInstructions = rewriteAccountCreationFundingInstructions(instructions, feePayerPubkey, TransactionInstruction);

  const {blockhash} = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({payerKey: feePayerPubkey, instructions: rewrittenInstructions, recentBlockhash: blockhash}).compileToV0Message(lookupTables);
  const transaction = new VersionedTransaction(message);
  // The fee payer here is deliberately Mango's own sponsor, not the
  // user — that's the whole point of this function. expectedSigner
  // still gets checked independently, so the user's own signature on
  // the real swap/transfer instructions remains required regardless of
  // who pays the fee.
  const warnings = assertSolanaTransactionMatchesIntent(transaction, {
    expectedSigner: keypair.publicKey.toBase58(),
    expectedFeePayer: feePayerPubkey.toBase58(),
  });

  transaction.sign([keypair]);

  const res = await fetch(SOLANA_SPONSOR_FEE_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({transaction: Buffer.from(transaction.serialize()).toString('base64')}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {error?: string};
    throw new Error(body.error || 'Fee sponsorship is not available right now.');
  }
  const {data} = (await res.json()) as {data?: {transaction?: string}};
  if (!data?.transaction) throw new Error('Fee sponsorship is not available right now.');

  const signedTransaction = VersionedTransaction.deserialize(Buffer.from(data.transaction, 'base64'));
  const signature = bs58.encode(signedTransaction.signatures[0]);
  await connection.sendRawTransaction(signedTransaction.serialize());
  return {signature: await confirmSolanaSignature(connection, signature), warnings};
}

async function signAndSendRelaySolanaStep(item: RelayTransactionStepItem, secretKeyBase58: string): Promise<{signature: string; warnings: string[]}> {
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

  // Real Solana pre-sign check (solanaTxIntent.ts) — was ported into
  // this repo but never actually called from the live signing path
  // (confirmed while auditing this file: no import of it existed here
  // at all). Runs on the exact object about to be signed, so a fee
  // payer that somehow isn't this wallet, or a hidden SPL Approve/
  // SetAuthority/CloseAccount instruction bundled into the swap, is
  // caught here instead of silently signed.
  const solanaWarnings = assertSolanaTransactionMatchesIntent(transaction, {expectedSigner: keypair.publicKey.toBase58()});

  transaction.sign([keypair]);
  const signature = bs58.encode(transaction.signatures[0]);

  try {
    await connection.sendRawTransaction(transaction.serialize());
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const lamportsMatch = errorMessage.match(/insufficient lamports (\d+), need (\d+)/i);
    if (lamportsMatch) {
      // Nothing was broadcast yet (this is our own pre-flight simulate
      // rejecting it) — safe to retry with Mango's fee payer covering
      // the shortfall instead of failing outright. Only falls through
      // to the plain "add more SOL" message if sponsorship itself isn't
      // available or also fails.
      try {
        return await signAndSendSponsoredSolanaStep(instructions, lookupTables, keypair, connection);
      } catch (sponsorErr) {
        const haveSol = Number(lamportsMatch[1]) / 1e9;
        const needSol = Number(lamportsMatch[2]) / 1e9;
        // Surface the real sponsorship failure instead of always
        // blaming the user's balance — sponsorship can fail for reasons
        // that have nothing to do with SOL (missing config, rate limit,
        // a rejected/failed simulation), and hiding that behind "add
        // more SOL" makes every one of those look identical and
        // impossible to debug.
        const sponsorMessage = sponsorErr instanceof Error ? sponsorErr.message : String(sponsorErr);
        throw new Error(
          `This wallet has ~${haveSol.toFixed(4)} SOL, short of the ~${needSol.toFixed(4)} SOL this route needs, and fee sponsorship didn't cover it: ${sponsorMessage}`,
        );
      }
    }
    try {
      await connection.sendRawTransaction(transaction.serialize(), {skipPreflight: true});
      const confirmedSignature = await confirmSolanaSignature(connection, signature);
      return {signature: confirmedSignature, warnings: solanaWarnings};
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
  return {signature: await confirmSolanaSignature(connection, signature), warnings: solanaWarnings};
}

/**
 * Same instruction/lookup-table/blockhash assembly as
 * signAndSendRelaySolanaStep above, but for a Google-login session:
 * there's no local secret key to sign with, so the built (unsigned)
 * VersionedTransaction is serialized and handed to Particle's own MPC
 * signer instead, which signs AND broadcasts in one call. Kept fully
 * separate from the local-signing function above — zero risk of this
 * path changing behavior for the existing, already-relied-on one.
 */
async function signAndSendRelaySolanaStepViaParticle(item: RelayTransactionStepItem, solanaAddress: string): Promise<{signature: string; warnings: string[]}> {
  const {Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction} = await import('@solana/web3.js');
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  const payerKey = new PublicKey(solanaAddress);

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
  const message = new TransactionMessage({payerKey, instructions, recentBlockhash: blockhash}).compileToV0Message(lookupTables);
  const transaction = new VersionedTransaction(message);

  // Same real pre-sign check as the local-signing path above, run on
  // the exact object about to be serialized and handed to Particle.
  const solanaWarnings = assertSolanaTransactionMatchesIntent(transaction, {expectedSigner: solanaAddress});

  const serialized = transaction.serialize();

  // Dynamic import, not a static one — see sendRelayEvmStepViaParticle's
  // own comment above for why (this file is also imported directly by
  // scripts/verify-execute-relay-quote.mjs's plain-Node offline checks).
  const {signAndSendSolanaTransactionViaParticle} = await import('../wallet/particleSigning.ts');
  const signature = await signAndSendSolanaTransactionViaParticle(serialized);

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
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return {signature, warnings: solanaWarnings};
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for transaction ${signature} to confirm.`);
    await new Promise(r => setTimeout(r, 1200));
  }
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
 *
 * `options.useGaslessTrading` (default false, per the caller's own
 * gaslessTradingPrefs.ts read) routes EVM steps through the
 * Pimlico-sponsored smart-account path instead of a plain wallet
 * transaction — silently ignored for a Google session (no local key to
 * sign a 7702 delegation with yet) or if Pimlico isn't configured, so a
 * stale "on" preference can never break plain trading.
 */
export async function executeRelayQuote(
  quote: RelayQuote,
  session: DerivedAccounts,
  onStep?: (step: ExecuteStep) => void,
  options?: {
    useGaslessTrading?: boolean;
    /**
     * Re-runs the exact same getRelayQuote() call the caller already made
     * to build `quote`, for the ONE case where retrying the identical
     * calldata isn't enough (see isTransientRevert below): the pool moved
     * and stayed moved, not just a momentary blip. Only ever invoked
     * before anything has broadcast (txHashes.length === 0), and at most
     * once per call — the recursive re-entry below drops this option so
     * a persistently-reverting route can't loop forever re-quoting.
     */
    requote?: () => Promise<RelayQuote>;
  },
): Promise<ExecuteRelayQuoteResult> {
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
  const isGoogleSession = session.authMethod === 'google';
  // A Google session has no local key to sign a 7702 delegation with
  // yet (smartAccount.ts isn't wired to Particle signing) — silently
  // falls back to the existing Particle path rather than erroring, so a
  // stale "on" preference from a since-switched-to-Google session can
  // never break trading.
  const useGasless = Boolean(options?.useGaslessTrading) && !isGoogleSession && isSmartAccountSponsorshipConfigured();
  const txHashes: string[] = [];
  let evmClients: {
    walletClient: ReturnType<typeof createWalletClient> | null;
    publicClient: ReturnType<typeof createPublicClient>;
    sponsoredClient: Awaited<ReturnType<typeof getSponsoredSmartAccountClient>> | null;
  } | null = null;

  for (const item of pendingItems) {
    if (isSolanaShaped(item)) {
      const {signature, warnings: solanaStepWarnings} = isGoogleSession
        ? await signAndSendRelaySolanaStepViaParticle(item, session.solana.address)
        : await signAndSendRelaySolanaStep(item, session.solana.privateKey);
      txHashes.push(signature);
      for (const warning of solanaStepWarnings) {
        console.warn(`[solanaTxIntent] ${warning}`);
      }
      warnings.push(...solanaStepWarnings);
      continue;
    }
    const chainId = item.data?.chainId;
    if (!chainId) throw new Error('The routing service returned a transaction with no chain.');
    if (!evmClients || evmClients.publicClient.chain?.id !== chainId) {
      const viemChain = viemChainForChainId(chainId);
      if (!viemChain) throw new Error(`No EVM chain configured for chain id ${chainId}.`);
      const transport = transportFor(chainId);
      const publicClient = createPublicClient({chain: viemChain, transport});
      const owner = isGoogleSession ? null : privateKeyToAccount(session.evm.privateKey as `0x${string}`);
      // Built unconditionally, not just when gasless trading is off — the
      // sponsored path below always needs a plain-transaction fallback to
      // drop back to. Gasless trading is still an opt-in beta
      // (ARCHITECTURE.md §1, never end-to-end proven before this shipped)
      // and a bundler/paymaster rejection must never strand an otherwise-
      // tradeable quote.
      const walletClient = owner ? createWalletClient({account: owner, chain: viemChain, transport}) : null;
      const sponsoredClient = owner && useGasless ? await getSponsoredSmartAccountClient({chain: viemChain, owner}) : null;
      evmClients = {walletClient, publicClient, sponsoredClient};
    }
    let hash: string;
    if (isGoogleSession) {
      hash = await sendRelayEvmStepViaParticle(session.evm.address as `0x${string}`, evmClients.publicClient, chainId, item);
    } else if (useGasless && evmClients.sponsoredClient) {
      try {
        hash = await sendRelayEvmStepSponsored(evmClients.sponsoredClient, evmClients.publicClient, item);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Only fall back on a rejection that happened BEFORE anything was
        // broadcast (the bundler's own field validation, or our own
        // pre-flight simulate) — never on an ambiguous failure after the
        // UserOperation may already have been accepted, where retrying
        // with a plain transaction could double-execute it.
        const isPreBroadcastRejection = /invalid fields set on user operation|invalid useroperation|\baa[0-9]{2}\b|this transaction would revert/i.test(message);
        if (!isPreBroadcastRejection) throw err;

        // "This transaction would revert" is OUR OWN pre-flight simulate
        // (sendRelayEvmStepSponsored above) catching an on-chain revert —
        // on a thin/fast-moving pool this is usually ordinary slippage
        // drift between quote and sign, not a real incompatibility. Real,
        // decoded case: a live trade's Pimlico log showed the router's
        // own "Return amount is not enough" revert; the identical calldata
        // simulated clean moments later with nothing else changed. Retry
        // the SAME sponsored path once before giving up on it — a plain
        // fallback can't actually save a gasless trade anyway, since a
        // gasless-mode wallet holds no native gas to pay for one by
        // design. A hard bundler rejection (invalid fields/an AA-code)
        // means real incompatibility, not drift, so that skips straight
        // to the fallback below instead of wasting a retry on it.
        const isTransientRevert = /this transaction would revert/i.test(message);
        if (isTransientRevert) {
          console.warn('[smartAccount] Sponsored UserOperation reverted in simulation, retrying once before falling back:', message);
          await new Promise(resolve => setTimeout(resolve, 1500));
          try {
            hash = await sendRelayEvmStepSponsored(evmClients.sponsoredClient, evmClients.publicClient, item);
          } catch {
            // The same calldata reverted twice a moment apart — the pool
            // moved and STAYED moved, not just a momentary blip the first
            // retry could ride out. Nothing has broadcast anywhere yet
            // (txHashes is still empty at this point, since this is
            // necessarily the first pendingItem — every earlier one would
            // already have pushed its hash), so it's still safe to throw
            // this quote away and get a fresh one with an up-to-date
            // minimum-output bound, rather than downgrade to a plain
            // transaction the wallet holds no gas to pay for by design.
            // options.requote is cleared on the recursive call so a route
            // that keeps reverting can re-quote at most once, not forever.
            if (txHashes.length === 0 && options?.requote) {
              console.warn('[smartAccount] Still reverting after retry — fetching a fresh quote and starting over.');
              const freshQuote = await options.requote();
              return executeRelayQuote(freshQuote, session, onStep, {...options, requote: undefined});
            }
            hash = await fallBackToPlainTransaction(evmClients.walletClient!, evmClients.publicClient, item);
          }
        } else {
          console.warn('[smartAccount] Sponsored UserOperation rejected before broadcast, falling back to a plain transaction:', message);
          hash = await fallBackToPlainTransaction(evmClients.walletClient!, evmClients.publicClient, item);
        }
      }
    } else {
      hash = await sendRelayEvmStep(evmClients.walletClient!, evmClients.publicClient, item);
    }
    txHashes.push(hash);
  }

  if (requestId) {
    onStep?.('filling');
    await pollRelayStatus(requestId);
  }
  onStep?.('done');
  return {txHashes, warnings};
}
