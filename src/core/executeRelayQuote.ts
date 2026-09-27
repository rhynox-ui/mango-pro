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

import {createPublicClient, createWalletClient, encodeFunctionData} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {transportFor, viemChainForChainId} from './chainRegistry.ts';
import {assertQuoteSafeToSign, type TransactionIntent} from './txIntentFirewall.ts';
import {assertSolanaTransactionMatchesIntent} from './solanaTxIntent.ts';
import {SOLANA_NATIVE_SPEND, assertSolanaSpendWithinIntentWeb3, isInsufficientSolSimulation, type SolanaSpendIntent} from './solanaSpendGuard.ts';
import {intentForQuote, type RelayQuote, type RelayTransactionStepItem} from './relayQuote.ts';
import {getEip7702AuthorizationIfNeeded, getSponsoredSmartAccountClient, isGaslessSupportedOnChain, isSmartAccountSponsorshipConfigured} from '../wallet/smartAccount.ts';
import {TOKEN_ADDRESSES, ASSET_ONCHAIN_DECIMALS, ARC_USDC, MAINNET_CHAIN_IDS, assetDecimalsForChain, chainKeyForChainId} from './chainData.ts';
import {DEV_FEE_WALLET} from './fees.ts';
import {fetchWalletPrices} from './walletPrices.ts';
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

/** What a Solana step may spend: exactly the trade's own input (see solanaSpendGuard.ts). */
function solanaSpendIntentFor(intent: TransactionIntent): SolanaSpendIntent {
  if (intent.originIsNative || !intent.originCurrency) return {spend: SOLANA_NATIVE_SPEND, maxSpend: intent.amount};
  return {spend: intent.originCurrency, maxSpend: intent.amount};
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

const ERC20_ALLOWANCE_ABI = [
  {type: 'function', name: 'allowance', inputs: [{name: 'owner', type: 'address'}, {name: 'spender', type: 'address'}], outputs: [{type: 'uint256'}], stateMutability: 'view'},
] as const;
const EVM_APPROVE_ABI = [
  {type: 'function', name: 'approve', inputs: [{name: 'spender', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}], stateMutability: 'nonpayable'},
] as const;

/**
 * Defensive recovery for a real, reproduced failure: a BNB Chain Convert
 * reverting on Relay's own Depository contract with Solady's
 * TransferFromFailed() (0x7939f424) — the Depository trying to pull the
 * origin token out of this wallet without (or without enough) prior
 * approval. Checked first, before adding this: BNB's own 18-decimal USDC
 * deploy (unlike the usual 6) is already correctly special-cased
 * everywhere this file and chainData.ts compute amounts, so this isn't
 * papering over a decimals bug on our side — it's a real fallback for
 * Relay's own quote omitting (or under-sizing) the approve step it
 * should have included for this route.
 *
 * Deliberately narrow: only ever runs as a RECOVERY after the original
 * call's own pre-flight simulate already reverted, only approves the
 * EXACT origin currency for the EXACT amount this quote is spending, and
 * only to the exact address the reverting call already targets — never a
 * blanket/unlimited approval, and never invoked on a route that already
 * works (the live allowance check below returns false immediately if
 * it's already sufficient, meaning this revert wasn't an allowance
 * problem at all).
 *
 * Returns WHY it didn't recover, not just whether it did — a Base Convert
 * failure surfaced the gap this closes: every "didn't recover" case used
 * to collapse into the same silent `false`, so a revert that survived
 * recovery and one that was never an allowance problem at all were
 * indistinguishable from the error the user saw. That made a second,
 * different-chain failure with the same generic message undiagnosable
 * without a live RPC trace this sandbox can't make. The reason is folded
 * into the final error text below so the NEXT occurrence is self-
 * explaining instead of needing another round of guessing.
 */
type AllowanceRecoveryResult =
  | {recovered: true}
  | {recovered: false; reason: string};

async function toppedUpOriginAllowance(
  publicClient: ReturnType<typeof createPublicClient>,
  owner: `0x${string}`,
  spender: `0x${string}`,
  originToken: `0x${string}` | undefined,
  originAmount: bigint | undefined,
  sendApproveTx: (data: `0x${string}`) => Promise<void>,
): Promise<AllowanceRecoveryResult> {
  if (!originToken || !originAmount || originAmount <= 0n) {
    return {recovered: false, reason: 'the origin currency for this quote is native, not an ERC-20 — an allowance can\'t be the cause'};
  }
  if (originToken.toLowerCase() === spender.toLowerCase()) {
    return {recovered: false, reason: 'the reverting call already targets the origin token itself, not a spender that could need an allowance'};
  }
  let currentAllowance: bigint;
  try {
    currentAllowance = await publicClient.readContract({address: originToken, abi: ERC20_ALLOWANCE_ABI, functionName: 'allowance', args: [owner, spender]});
  } catch (err) {
    return {recovered: false, reason: `could not read the live allowance to check: ${err instanceof Error ? err.message : String(err)}`};
  }
  if (currentAllowance >= originAmount) {
    return {recovered: false, reason: 'the allowance is already sufficient for this amount — not an approval problem'};
  }
  try {
    const data = encodeFunctionData({abi: EVM_APPROVE_ABI, functionName: 'approve', args: [spender, originAmount]});
    await sendApproveTx(data);
    return {recovered: true};
  } catch (err) {
    return {recovered: false, reason: `the approval transaction itself failed: ${err instanceof Error ? err.message : String(err)}`};
  }
}

/**
 * Prepends WHY the allowance-recovery attempt didn't save this call, so the
 * final error is self-explaining instead of a bare repeat of the same
 * revert. Real, confirmed bug this closes: viem's own `err.message` for a
 * failed `.call()` is itself multi-line (a one-line summary, then a blank
 * line, then "Raw Call Arguments:", "Docs:", "Version:", etc.) —
 * describeTradeError's own `firstLine()` exists specifically to avoid
 * dumping that block on screen, so it keeps only the text before the
 * FIRST newline. Putting this note AFTER `message` (as this used to) means
 * it lands past that first newline and gets silently discarded — a live
 * BNB Chain Convert failure showed exactly the bare revert reason with
 * none of this context, even though the recovery logic below had already
 * run and recorded why it didn't help. Putting the note first keeps it on
 * the same line firstLine() actually keeps.
 */
function revertMessageAfterFailedRecovery(message: string, recovery: {recovered: false; reason: string}): string {
  return `(Checked for a missing allowance first: ${recovery.reason}.) ${message}`;
}

/**
 * On Arc, the USDC ERC-20 a step spends and the gas it pays come out of
 * one balance: eth_getBalance reports it with 18 decimals, the token with
 * 6. The native-balance check must count the USDC being spent too, or a
 * MAX-sized trade passes the check and then reverts on-chain after the
 * gas is already taken. Returns that USDC in native (18-decimal) units,
 * or 0n on every other chain and for any other origin token.
 */
export function arcUsdcSpendInNativeUnits(chainId: number | undefined, originToken: `0x${string}` | undefined, originAmount: bigint | undefined): bigint {
  if (chainId !== MAINNET_CHAIN_IDS.arc || !originToken || !originAmount || originAmount <= 0n) return 0n;
  if (originToken.toLowerCase() !== ARC_USDC) return 0n;
  return originAmount * 10n ** 12n;
}

const ARC_INSUFFICIENT_MESSAGE = "Insufficient USDC for network fees on Arc. Gas there is paid in the same USDC you're spending — try a slightly smaller amount.";

/**
 * Sends one EVM-side Relay step. Simulates first (publicClient.call) so
 * a route that would revert on-chain fails with a real, readable reason
 * instead of burning gas to find out; then checks the native balance
 * actually covers value + worst-case gas cost before broadcasting.
 *
 * `originToken`/`originAmount` (the whole quote's currencyIn — see
 * executeRelayQuote's own top) are only ever consulted if this pre-flight
 * simulate reverts, as the allowance-recovery fallback above.
 */
async function sendRelayEvmStep(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  item: RelayTransactionStepItem,
  originToken?: `0x${string}`,
  originAmount?: bigint,
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
      const recovery = await toppedUpOriginAllowance(publicClient, account.address, tx.to, originToken, originAmount, async approveData => {
        const hash = await walletClient.sendTransaction({account, to: originToken!, data: approveData, value: 0n, chain: walletClient.chain});
        await publicClient.waitForTransactionReceipt({hash});
      });
      if (!recovery.recovered) throw new Error(`This transaction would revert: ${revertMessageAfterFailedRecovery(message, recovery)}`);
      try {
        await publicClient.call(tx);
      } catch (err2) {
        const message2 = err2 instanceof Error ? err2.message : String(err2);
        throw new Error(`This transaction would revert: (An allowance top-up was sent first, but the retry still reverted the same way.) ${message2}`);
      }
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
  const arcUsdcSpend = arcUsdcSpendInNativeUnits(walletClient.chain?.id, originToken, originAmount);
  const worstCaseCost = tx.value + gas * maxFeePerGas + arcUsdcSpend;
  if (nativeBalance < worstCaseCost) {
    if (arcUsdcSpend > 0n) throw new Error(ARC_INSUFFICIENT_MESSAGE);
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
  originToken?: `0x${string}`,
  originAmount?: bigint,
): Promise<string> {
  try {
    return await sendRelayEvmStep(walletClient, publicClient, item, originToken, originAmount);
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
async function sendRelayEvmStepViaParticle(
  evmAddress: `0x${string}`,
  publicClient: ReturnType<typeof createPublicClient>,
  chainId: number,
  item: RelayTransactionStepItem,
  originToken?: `0x${string}`,
  originAmount?: bigint,
): Promise<string> {
  const {to, data, value} = item.data ?? {};
  if (!to) throw new Error('The routing service returned a transaction with no destination address.');
  const tx = {to: to as `0x${string}`, data: (data || undefined) as `0x${string}` | undefined, value: value ? BigInt(value) : 0n};

  try {
    await publicClient.call({account: evmAddress, to: tx.to, data: tx.data, value: tx.value});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message && !/timeout|network|fetch|429|403/i.test(message)) {
      const recovery = await toppedUpOriginAllowance(publicClient, evmAddress, tx.to, originToken, originAmount, async approveData => {
        const {sendEvmTransactionViaParticle} = await import('../wallet/particleSigning.ts');
        const hash = await sendEvmTransactionViaParticle(evmAddress, {chainId, to: originToken!, data: approveData, value: 0n});
        await publicClient.waitForTransactionReceipt({hash});
      });
      if (!recovery.recovered) throw new Error(`This transaction would revert: ${revertMessageAfterFailedRecovery(message, recovery)}`);
      try {
        await publicClient.call({account: evmAddress, to: tx.to, data: tx.data, value: tx.value});
      } catch (err2) {
        const message2 = err2 instanceof Error ? err2.message : String(err2);
        throw new Error(`This transaction would revert: (An allowance top-up was sent first, but the retry still reverted the same way.) ${message2}`);
      }
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
  const arcUsdcSpend = arcUsdcSpendInNativeUnits(chainId, originToken, originAmount);
  const worstCaseCost = tx.value + gas * maxFeePerGas + arcUsdcSpend;
  if (nativeBalance < worstCaseCost) {
    if (arcUsdcSpend > 0n) throw new Error(ARC_INSUFFICIENT_MESSAGE);
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

// ---------------------------------------------------------------------
// EVM half of sponsorship cost recovery — same design contract as the
// Solana section above (this file's own header there has the full
// precedent citations), adapted to what's actually available on this
// side: Pimlico's own paymaster sponsors gas here (not a Mango-operated
// native-gas wallet the way Solana's fee payer is), billed against a
// real funded Pimlico balance — so this closes the exact same "pure
// gift, never recovered" gap Relay's own subsidizeFees path already
// closes via appFeeBpsForSponsoredTrade()'s quote-time bps, except
// Pimlico's sponsorship was never wired into that bps decision at all
// (it's a separate, independently-toggled opt-in — see smartAccount.ts).
//
// The atomic-in-the-same-operation shape survives the move to EVM
// almost exactly: a 7702 smart account can batch multiple calls into
// ONE UserOperation (permissionless's own sendTransaction wraps a
// single {to,data,value} into exactly this `calls` array already — see
// node_modules/permissionless/actions/smartAccount/sendTransaction.js),
// so appending a second call (an ERC-20 USDC transfer to Mango's
// existing DEV_FEE_WALLET — already the appFees recipient, no new
// address to provision) is the direct EVM equivalent of Solana's second
// SPL-transfer instruction. No sponsor-side account needs creating
// here either: DEV_FEE_WALLET is a plain EOA, already set up to receive
// USDC.
//
// What's genuinely different from Solana: there's no single "simulate,
// read real units, done" call — viem/permissionless splits that into
// `prepareUserOperation` (real gas-field estimation, no broadcast) and
// `sendTransaction` (broadcasts). So the shape here is: prepare the
// swap-only operation to measure its real worst-case native cost
// (never guessed), decide whether to attempt recovery, then — if
// attempting — prepare the COMBINED (swap + recovery) operation as the
// actual pre-flight check. Nothing broadcasts during either prepare
// call, so it's always safe to fall back to the swap-only calls if
// EITHER prepare throws (paymaster policy rejects the extra call,
// price feed missing, insufficient USDC, anything) — exactly one
// `sendTransaction` (broadcast) ever happens, chosen upfront, never a
// blind retry after a real broadcast attempt.

const ERC20_TRANSFER_ABI = [
  {type: 'function', name: 'transfer', inputs: [{name: 'to', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}], stateMutability: 'nonpayable'},
] as const;
const ERC20_BALANCE_OF_ABI = [
  {type: 'function', name: 'balanceOf', inputs: [{name: 'account', type: 'address'}], outputs: [{type: 'uint256'}], stateMutability: 'view'},
] as const;

/**
 * Real native-gas cost (wei) -> USDC base units for this chain, live
 * priced and buffered exactly like the Solana side
 * (sponsorshipRecoveryUsdcUnits) — same non-profit buffer constant, same
 * "0 means skip, never guess" contract on a missing/invalid input. Takes
 * `usdcDecimals` explicitly rather than assuming 6, since BNB Chain's
 * own USDC deploy uses 18 (assetDecimalsForChain in chainData.ts already
 * carries this exception). Pure, independently testable.
 */
export function evmSponsorshipRecoveryUsdcUnits(nativeCostWei: bigint, nativePriceUsd: number, usdcDecimals: number): bigint {
  if (!(nativeCostWei > 0n) || !(nativePriceUsd > 0)) return 0n;
  const nativeCost = Number(nativeCostWei) / 1e18;
  const recoveryUsd = nativeCost * nativePriceUsd * (1 + SPONSORSHIP_RECOVERY_BUFFER_PCT);
  return BigInt(Math.round(recoveryUsd * 10 ** usdcDecimals));
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
  originToken?: `0x${string}`,
  originAmount?: bigint,
): Promise<string> {
  const {to, data, value} = item.data ?? {};
  if (!to) throw new Error('The routing service returned a transaction with no destination address.');
  const tx = {to: to as `0x${string}`, data: (data || undefined) as `0x${string}` | undefined, value: value ? BigInt(value) : 0n};

  // See smartAccount.ts's own header for the real bug this closes: the
  // installed viem's automatic path only ever attaches a STUB (fake)
  // EIP-7702 authorization, which Pimlico's bundler rejects outright —
  // a real one has to be signed and passed explicitly here. Computed up
  // front (not only right before the final send, as before this recovery
  // path existed) so a standalone approve UserOperation below can also
  // carry it on a not-yet-delegated EOA.
  const authorization = await getEip7702AuthorizationIfNeeded(client, publicClient);

  try {
    await publicClient.call({account: client.account.address, to: tx.to, data: tx.data, value: tx.value});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message && !/timeout|network|fetch|429|403/i.test(message)) {
      const recovery = await toppedUpOriginAllowance(publicClient, client.account.address, tx.to, originToken, originAmount, async approveData => {
        const hash = await client.sendTransaction({calls: [{to: originToken!, data: approveData, value: 0n}], authorization});
        await publicClient.waitForTransactionReceipt({hash});
      });
      if (!recovery.recovered) throw new Error(`This transaction would revert: ${revertMessageAfterFailedRecovery(message, recovery)}`);
      try {
        await publicClient.call({account: client.account.address, to: tx.to, data: tx.data, value: tx.value});
      } catch (err2) {
        const message2 = err2 instanceof Error ? err2.message : String(err2);
        throw new Error(`This transaction would revert: (An allowance top-up was sent first, but the retry still reverted the same way.) ${message2}`);
      }
    }
  }

  const swapCall = {to: tx.to, data: tx.data ?? ('0x' as const), value: tx.value};

  // Cost recovery — strictly opportunistic, per this section's own
  // header above. Any failure anywhere in this block just means the
  // single swapCall below goes out exactly as it always has.
  let calls: {to: `0x${string}`; data: `0x${string}`; value: bigint}[] = [swapCall];
  try {
    const chainId = publicClient.chain?.id;
    const chainKey = typeof chainId === 'number' ? chainKeyForChainId(chainId) : undefined;
    const usdcAddress = chainKey ? TOKEN_ADDRESSES.USDC?.[chainKey] : undefined;
    if (chainKey && usdcAddress) {
      const basePrepared = await client.prepareUserOperation({calls: [swapCall], authorization});
      const totalGas =
        basePrepared.callGasLimit +
        basePrepared.verificationGasLimit +
        basePrepared.preVerificationGas +
        (basePrepared.paymasterVerificationGasLimit ?? 0n) +
        (basePrepared.paymasterPostOpGasLimit ?? 0n);
      const worstCaseNativeCost = totalGas * basePrepared.maxFeePerGas;

      const nativeSymbol = publicClient.chain?.nativeCurrency?.symbol;
      const prices = await fetchWalletPrices().catch(() => ({}) as Record<string, number>);
      const nativePriceUsd = (nativeSymbol && prices[nativeSymbol]) || 0;
      const usdcDecimals = assetDecimalsForChain(chainKey, 'USDC') ?? ASSET_ONCHAIN_DECIMALS.USDC;
      const recoveryUnits = evmSponsorshipRecoveryUsdcUnits(worstCaseNativeCost, nativePriceUsd, usdcDecimals);

      if (recoveryUnits > 0n) {
        const usdcBalance = await publicClient
          .readContract({address: usdcAddress as `0x${string}`, abi: ERC20_BALANCE_OF_ABI, functionName: 'balanceOf', args: [client.account.address]})
          .catch(() => null);
        if (typeof usdcBalance === 'bigint' && usdcBalance >= recoveryUnits) {
          const recoveryCall = {
            to: usdcAddress as `0x${string}`,
            data: encodeFunctionData({abi: ERC20_TRANSFER_ABI, functionName: 'transfer', args: [DEV_FEE_WALLET as `0x${string}`, recoveryUnits]}),
            value: 0n,
          };
          // The real pre-flight: nothing broadcasts on a failed prepare
          // (a paymaster policy rejection, a gas-estimation revert on
          // the recovery call itself, anything), so it's always safe to
          // fall back to swap-only if this throws.
          await client.prepareUserOperation({calls: [swapCall, recoveryCall], authorization});
          calls = [swapCall, recoveryCall];
        }
      }
    }
  } catch (err) {
    console.warn('[sponsorshipRecovery] Skipping EVM cost recovery for this trade:', err instanceof Error ? err.message : String(err));
  }

  try {
    const hash = await client.sendTransaction({calls, authorization});
    await publicClient.waitForTransactionReceipt({hash});
    return hash;
  } catch (err) {
    // Real gap this closes, live-reproduced (a BNB Convert reverting with
    // the exact TransferFromFailed() this function's own pre-flight
    // simulate above is meant to catch and recover from — but didn't).
    // Pimlico's bundler runs its OWN simulation as part of actually
    // broadcasting the UserOperation, a separate check from this
    // function's own `publicClient.call()` pre-flight above — a route
    // that simulates clean via a plain eth_call can still be rejected
    // here, and until now a revert caught ONLY at this later point never
    // got a chance at allowance-recovery at all, surfacing instead as
    // whatever raw error shape the bundler SDK happens to produce
    // (unrecovered AND un-narrated — exactly what a live failure showed).
    // Same guard, same recovery call, same retry-once shape as the
    // pre-flight block above, just applied to this later checkpoint too.
    const message = err instanceof Error ? err.message : String(err);
    if (!message || /timeout|network|fetch|429|403/i.test(message)) throw err;
    const recovery = await toppedUpOriginAllowance(publicClient, client.account.address, swapCall.to, originToken, originAmount, async approveData => {
      const approveHash = await client.sendTransaction({calls: [{to: originToken!, data: approveData, value: 0n}], authorization});
      await publicClient.waitForTransactionReceipt({hash: approveHash});
    });
    if (!recovery.recovered) throw new Error(`This transaction would revert: ${revertMessageAfterFailedRecovery(message, recovery)}`);
    try {
      const hash = await client.sendTransaction({calls, authorization});
      await publicClient.waitForTransactionReceipt({hash});
      return hash;
    } catch (err2) {
      const message2 = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(`This transaction would revert: (An allowance top-up was sent first, but the retry still reverted the same way.) ${message2}`);
    }
  }
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

// ---------------------------------------------------------------------
// Sponsorship cost recovery — closing the loop the fee-payer wallet's
// own header (mango-api's solana-fee-payer.js) explicitly leaves open:
// with the per-address/daily caps removed, this wallet keeps covering
// sponsored trades until it runs dry, with no other backstop. This
// section is what refills it, WITHOUT ever risking the trade it's
// supposed to be protecting — see the design contract below.
//
// Design, per real precedent (Kora/Circle Gas Station/Openfort docs —
// all recover cost with an SPL transfer to the fee payer's own account,
// executed INSIDE the same sponsored transaction, not a quote-time %):
//
//  1. RECOVER EXACTLY REAL COST, PLUS A NON-PROFIT BUFFER. The amount is
//     this transaction's own measured lamports cost (base fee + any
//     rent this fee payer is now funding — read from the ORIGINAL,
//     pre-rewrite instructions, not guessed), priced live via
//     walletPrices.ts's SOL/USD feed (so it tracks SOL's own volatility
//     instead of a stale $ constant), plus SPONSORSHIP_RECOVERY_BUFFER_PCT
//     — sized only to cover the eventual USDC->SOL conversion cost when
//     this wallet's accumulated USDC gets swept back into SOL, never a
//     margin on top of real cost. Explicit product decision: recovering
//     MORE than what sponsorship actually cost is the same "cheating"
//     the flat appFeeBpsForSponsoredTrade()/sponsoredFeeFloorUsd() path
//     in fees.ts already exists to avoid on the Relay-sponsorship side.
//
//  2. NEVER IN THE WAY OF THE TRADE. Recovery is denominated in USDC and
//     paid from whatever USDC the user's wallet already holds (checked
//     against a live balance, not assumed) — deliberately NOT tied to
//     this specific swap's own origin/destination currency, so it works
//     the same whether the swap is a Buy or a Sell, paid in USDC or in
//     anything else. If the user doesn't hold enough USDC, or ANYTHING
//     about the augmented transaction fails to simulate clean (a stale
//     balance snapshot, a compute-budget conflict, whatever), the whole
//     recovery attempt is dropped and the plain, already-working
//     sponsored transaction is sent instead — recovery is strictly
//     opportunistic, the trade succeeding is not.
//
//  3. MEASURE, DON'T GUESS, THE COMPUTE BUDGET. An added SPL transfer
//     costs real compute units Relay's own route never budgeted for
//     (https://57blocks.com/blog/deep-dive-into-resource-limitations-in-solana-development-cu-edition).
//     The augmented instruction set is simulated BEFORE it's ever
//     signed (sigVerify: false, replaceRecentBlockhash: true — the same
//     pattern mango-api's own coSignAsFeePayer already uses server-side)
//     and, only if that simulation comes back clean, its real
//     unitsConsumed is used to correct (or add) a SetComputeUnitLimit
//     instruction to ~110% of that measured value
//     (https://docs.chainstack.com/docs/solana-compute-budget) — never a
//     flat guessed number.
//
// The sponsor's own USDC associated token account is created lazily,
// idempotently, the first time it's needed — funded by the fee payer's
// OWN signature for its OWN account, so there's no user-funds risk in
// that half of it either.

const LAMPORTS_PER_SIGNATURE = 5000;
// Real SPL Token account size, verified against the SPL Token program's
// own account layout (same 165-byte constant already relied on
// elsewhere in this codebase's fee-sponsorship work) — the Associated
// Token Account program computes this rent internally via a CPI, so
// unlike SystemProgram.createAccount's own explicit `lamports` field
// (read directly from instruction data below), there's nothing to read
// off an ATA-Create instruction itself; this is what
// getMinimumBalanceForRentExemption is actually pricing.
const SPL_TOKEN_ACCOUNT_SPACE = 165;
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
// ComputeBudgetInstruction enum's SetComputeUnitLimit variant.
const COMPUTE_BUDGET_SET_UNIT_LIMIT_DISCRIMINANT = 2;
// Not profit — see this section's own header, point 1. Sized to cover
// the real, if modest, cost of eventually converting this wallet's
// accumulated USDC back into the SOL it actually needs to keep
// sponsoring trades with.
const SPONSORSHIP_RECOVERY_BUFFER_PCT = 0.01;
// Simulate-then-correct margin over the REAL measured compute units —
// never a guessed absolute number. See this section's own header,
// point 3.
const COMPUTE_BUDGET_SAFETY_MULTIPLE = 1.1;

/**
 * Real lamports cost of sponsoring this specific transaction: the base
 * network fee (one signature per required signer) plus any account-rent
 * this fee payer is now funding, per the account-creation rewrite above.
 * Reads directly off the ORIGINAL (pre-rewrite) instructions — a
 * SystemProgram.createAccount/-WithSeed instruction's own `lamports`
 * field (the u64 immediately after the 4-byte discriminant, per
 * system_instruction.rs) already carries the exact rent-exempt amount
 * whoever built this route funded it with; an Associated Token Account
 * Create/CreateIdempotent instruction carries no such field (the program
 * computes it internally), so that case is priced via
 * `tokenAccountRentExemptLamports` — resolved once, live, by the caller
 * (connection.getMinimumBalanceForRentExemption), never hardcoded.
 * Pure and independently testable — no network I/O of its own.
 */
export function estimateSponsorshipLamportsCost(
  instructions: InstanceType<typeof import('@solana/web3.js').TransactionInstruction>[],
  numRequiredSignatures: number,
  tokenAccountRentExemptLamports: number,
): number {
  let rentCost = 0;
  let needsTokenAccountRent = false;
  for (const ix of instructions) {
    const programId = ix.programId.toBase58();
    if (programId === SYSTEM_PROGRAM_ID && ix.data.length >= 12 && SYSTEM_ACCOUNT_CREATING_DISCRIMINANTS.has(ix.data.readUInt32LE(0))) {
      rentCost += Number(ix.data.readBigUInt64LE(4));
    } else if (programId === ASSOCIATED_TOKEN_PROGRAM_ID) {
      needsTokenAccountRent = true;
    }
  }
  if (needsTokenAccountRent) rentCost += tokenAccountRentExemptLamports;
  return Math.max(0, numRequiredSignatures) * LAMPORTS_PER_SIGNATURE + rentCost;
}

/**
 * Real cost -> USDC base units, live-priced (never a hardcoded $
 * estimate — SOL is too volatile for that, per the product decision
 * this implements) plus the non-profit conversion buffer. Pure — the
 * live price itself is fetched by the caller (walletPrices.ts) and
 * passed in, so this stays independently testable against fixed inputs.
 * Returns 0 (meaning: skip recovery, don't guess) whenever either input
 * isn't a real positive number.
 */
export function sponsorshipRecoveryUsdcUnits(lamportsCost: number, solPriceUsd: number): number {
  if (!(lamportsCost > 0) || !(solPriceUsd > 0)) return 0;
  const solCost = lamportsCost / 1_000_000_000;
  const recoveryUsd = solCost * solPriceUsd * (1 + SPONSORSHIP_RECOVERY_BUFFER_PCT);
  return Math.round(recoveryUsd * 10 ** ASSET_ONCHAIN_DECIMALS.USDC);
}

/**
 * Sets (or corrects) this instruction set's compute-unit budget to
 * `units`, IN PLACE OF any existing SetComputeUnitLimit instruction
 * Relay's own route may already include — two such instructions in one
 * transaction is a runtime error, not additive, so this replaces rather
 * than appends when one is already present. Prepends a new one
 * (ComputeBudget instructions are conventionally first, though the
 * runtime scans for them regardless of position) when none exists.
 * Pure, independently testable.
 */
export function withComputeUnitLimit(
  instructions: InstanceType<typeof import('@solana/web3.js').TransactionInstruction>[],
  units: number,
  computeUnitLimitInstruction: InstanceType<typeof import('@solana/web3.js').TransactionInstruction>,
): InstanceType<typeof import('@solana/web3.js').TransactionInstruction>[] {
  const existingIndex = instructions.findIndex(ix => ix.programId.toBase58() === COMPUTE_BUDGET_PROGRAM_ID && ix.data.length >= 1 && ix.data[0] === COMPUTE_BUDGET_SET_UNIT_LIMIT_DISCRIMINANT);
  if (existingIndex >= 0) {
    const copy = [...instructions];
    copy[existingIndex] = computeUnitLimitInstruction;
    return copy;
  }
  return [computeUnitLimitInstruction, ...instructions];
}

/**
 * Whoever is signing the user's half of a sponsored transaction — a
 * local Keypair (signAndSendRelaySolanaStep's own fallback) or Particle
 * MPC (signAndSendRelaySolanaStepViaParticle's own fallback, added
 * alongside the EVM/Solana cost-recovery work above). signAndSendSponsoredSolanaStep
 * below needs the SAME recovery/compute-budget logic regardless of
 * which one it is — this is the one seam that differs, so it's the one
 * thing abstracted, not a speculative interface for cases that don't
 * exist yet.
 */
export type SolanaTransactionSigner = {
  publicKey: InstanceType<typeof import('@solana/web3.js').PublicKey>;
  sign: (transaction: InstanceType<typeof import('@solana/web3.js').VersionedTransaction>) => Promise<InstanceType<typeof import('@solana/web3.js').VersionedTransaction>>;
};

// Exported so sendUsdc.ts's own Solana withdrawal can reuse this exact,
// already-tested fee-payer path on an "insufficient lamports" shortfall
// — same real gap trades used to have, same fix, no reason to duplicate
// the rewrite/sign/co-sign/broadcast logic (or its cost-recovery
// attempt, which stays opportunistic and harmless here too) a second
// time for a different caller.
export async function signAndSendSponsoredSolanaStep(
  instructions: InstanceType<typeof import('@solana/web3.js').TransactionInstruction>[],
  lookupTables: InstanceType<typeof import('@solana/web3.js').AddressLookupTableAccount>[],
  signer: SolanaTransactionSigner,
  connection: InstanceType<typeof import('@solana/web3.js').Connection>,
  spendIntent?: SolanaSpendIntent,
): Promise<{signature: string; warnings: string[]}> {
  const [{PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram}, bs58Module, splToken] = await Promise.all([
    import('@solana/web3.js'),
    import('bs58'),
    import('@solana/spl-token'),
  ]);
  const bs58 = bs58Module.default;
  const feePayerPubkey = new PublicKey(await getSolanaFeePayerPublicKey());
  const rewrittenInstructions = rewriteAccountCreationFundingInstructions(instructions, feePayerPubkey, TransactionInstruction);

  const {blockhash} = await connection.getLatestBlockhash('confirmed');
  let finalInstructions = rewrittenInstructions;
  // USDC this transaction's own cost recovery adds on top of the trade —
  // allowed by the spend guard below as Mango's, not the route's.
  let recoveryUnitsIncluded = 0n;

  // Cost recovery — strictly opportunistic, per this file's own header
  // above. Any failure anywhere in this block (no live price, no/not
  // enough USDC, a bad simulation) is caught and logged; it never
  // prevents the plain sponsored transaction below from going out.
  try {
    const usdcMintAddress = TOKEN_ADDRESSES.USDC?.solana;
    if (usdcMintAddress) {
      const probeMessage = new TransactionMessage({payerKey: feePayerPubkey, instructions: rewrittenInstructions, recentBlockhash: blockhash}).compileToV0Message(lookupTables);
      const numRequiredSignatures = probeMessage.header.numRequiredSignatures;
      const usdcMint = new PublicKey(usdcMintAddress);
      const needsTokenAccountRent = instructions.some(ix => ix.programId.toBase58() === ASSOCIATED_TOKEN_PROGRAM_ID);
      const tokenAccountRentExemptLamports = needsTokenAccountRent ? await connection.getMinimumBalanceForRentExemption(SPL_TOKEN_ACCOUNT_SPACE) : 0;
      const lamportsCost = estimateSponsorshipLamportsCost(instructions, numRequiredSignatures, tokenAccountRentExemptLamports);

      const prices = await fetchWalletPrices().catch(() => ({}) as Record<string, number>);
      const recoveryUnits = sponsorshipRecoveryUsdcUnits(lamportsCost, prices.SOL ?? 0);

      if (recoveryUnits > 0) {
        const userUsdcAta = await splToken.getAssociatedTokenAddress(usdcMint, signer.publicKey);
        const userUsdcBalance = await connection.getTokenAccountBalance(userUsdcAta).catch(() => null);
        const userUsdcUnits = userUsdcBalance ? Number(userUsdcBalance.value.amount) : 0;

        if (userUsdcUnits >= recoveryUnits) {
          const sponsorUsdcAta = await splToken.getAssociatedTokenAddress(usdcMint, feePayerPubkey);
          const sponsorAtaInfo = await connection.getAccountInfo(sponsorUsdcAta);
          const candidateInstructions = [...rewrittenInstructions];
          if (!sponsorAtaInfo) {
            // The sponsor funds its OWN receiving account with its OWN
            // signature — no user funds touched by this instruction.
            candidateInstructions.push(splToken.createAssociatedTokenAccountInstruction(feePayerPubkey, sponsorUsdcAta, feePayerPubkey, usdcMint));
          }
          candidateInstructions.push(splToken.createTransferInstruction(userUsdcAta, sponsorUsdcAta, signer.publicKey, recoveryUnits));

          const candidateMessage = new TransactionMessage({payerKey: feePayerPubkey, instructions: candidateInstructions, recentBlockhash: blockhash}).compileToV0Message(lookupTables);
          const candidateTransaction = new VersionedTransaction(candidateMessage);
          const simulation = await connection.simulateTransaction(candidateTransaction, {sigVerify: false, replaceRecentBlockhash: true});

          if (!simulation.value.err && typeof simulation.value.unitsConsumed === 'number') {
            const safeUnits = Math.ceil(simulation.value.unitsConsumed * COMPUTE_BUDGET_SAFETY_MULTIPLE);
            const computeUnitLimitInstruction = ComputeBudgetProgram.setComputeUnitLimit({units: safeUnits});
            finalInstructions = withComputeUnitLimit(candidateInstructions, safeUnits, computeUnitLimitInstruction);
            recoveryUnitsIncluded = BigInt(recoveryUnits);
          } else if (simulation.value.err) {
            console.warn('[sponsorshipRecovery] Augmented transaction did not simulate clean — sending the plain sponsored transaction instead:', JSON.stringify(simulation.value.err));
          }
        }
      }
    }
  } catch (err) {
    console.warn('[sponsorshipRecovery] Skipping cost recovery for this trade:', err instanceof Error ? err.message : String(err));
  }

  const message = new TransactionMessage({payerKey: feePayerPubkey, instructions: finalInstructions, recentBlockhash: blockhash}).compileToV0Message(lookupTables);
  const unsignedTransaction = new VersionedTransaction(message);
  // The fee payer here is deliberately Mango's own sponsor, not the
  // user — that's the whole point of this function. expectedSigner
  // still gets checked independently, so the user's own signature on
  // the real swap/transfer instructions remains required regardless of
  // who pays the fee.
  const warnings = assertSolanaTransactionMatchesIntent(unsignedTransaction, {
    expectedSigner: signer.publicKey.toBase58(),
    expectedFeePayer: feePayerPubkey.toBase58(),
  });
  // The semantic check (solanaSpendGuard.ts): the wallet's balances may
  // only change as the trade allows. Sponsorship moves who pays the fee,
  // not what the user may lose.
  if (spendIntent) {
    const usdcMintAddress = TOKEN_ADDRESSES.USDC?.solana;
    const extra = recoveryUnitsIncluded > 0n && usdcMintAddress ? [...(spendIntent.extra ?? []), {mint: usdcMintAddress, units: recoveryUnitsIncluded}] : spendIntent.extra;
    await assertSolanaSpendWithinIntentWeb3(connection, unsignedTransaction, signer.publicKey.toBase58(), {...spendIntent, extra});
  }

  const transaction = await signer.sign(unsignedTransaction);

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

async function signAndSendRelaySolanaStep(item: RelayTransactionStepItem, secretKeyBase58: string, spendIntent: SolanaSpendIntent): Promise<{signature: string; warnings: string[]}> {
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

  const localSigner: SolanaTransactionSigner = {
    publicKey: keypair.publicKey,
    sign: async tx => {
      tx.sign([keypair]);
      return tx;
    },
  };
  // The semantic check (solanaSpendGuard.ts), before anything is signed.
  // A wallet short of SOL can't be simulated as its own fee payer — that
  // case goes straight to Mango's sponsored path, which runs the same
  // check with the sponsor paying.
  try {
    await assertSolanaSpendWithinIntentWeb3(connection, transaction, keypair.publicKey.toBase58(), spendIntent);
  } catch (guardErr) {
    if (!isInsufficientSolSimulation(guardErr)) throw guardErr;
    try {
      return await signAndSendSponsoredSolanaStep(instructions, lookupTables, localSigner, connection, spendIntent);
    } catch (sponsorErr) {
      const sponsorMessage = sponsorErr instanceof Error ? sponsorErr.message : String(sponsorErr);
      throw new Error(`This wallet doesn't have enough SOL for this route's network fees, and fee sponsorship didn't cover it: ${sponsorMessage}`);
    }
  }

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
        return await signAndSendSponsoredSolanaStep(instructions, lookupTables, localSigner, connection, spendIntent);
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
 * signer instead — via signAndSendSolanaTransactionViaParticle
 * (sign-and-broadcast in one call) on the normal, sufficient-balance
 * path, or via the sign-only signSolanaTransactionViaParticle when the
 * fee-payer fallback below needs to add the sponsor's own signature
 * before anything broadcasts.
 *
 * The local-signing function's own fallback detects a shortfall by
 * catching the RPC's "insufficient lamports X, need Y" rejection text
 * AFTER attempting to submit — Particle's own sign-and-send collapses
 * signing and broadcast into one call with no confirmed guarantee its
 * error surface preserves that same RPC text, so this path checks
 * BEFORE ever calling Particle instead: compute this transaction's own
 * real lamports need with the exact same estimateSponsorshipLamportsCost
 * math the fee-payer's own cost-recovery uses, and compare it against a
 * real getBalance() read. Same outcome (sponsor when short, don't when
 * not), a more robust trigger for this specific signer.
 */
async function signAndSendRelaySolanaStepViaParticle(item: RelayTransactionStepItem, solanaAddress: string, spendIntent: SolanaSpendIntent): Promise<{signature: string; warnings: string[]}> {
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
  // The semantic check (solanaSpendGuard.ts), before Particle signs. A
  // wallet short of SOL can't be simulated as its own fee payer; the
  // balance check below then takes the sponsored path, which runs the
  // same check with the sponsor paying.
  let spendVerified = false;
  try {
    await assertSolanaSpendWithinIntentWeb3(connection, transaction, solanaAddress, spendIntent);
    spendVerified = true;
  } catch (guardErr) {
    if (!isInsufficientSolSimulation(guardErr)) throw guardErr;
  }

  // Pre-flight balance check — see this function's own header for why
  // this replaces the local-signing path's catch-the-RPC-error approach
  // for this specific signer.
  try {
    const needsTokenAccountRent = instructions.some(ix => ix.programId.toBase58() === ASSOCIATED_TOKEN_PROGRAM_ID);
    const tokenAccountRentExemptLamports = needsTokenAccountRent ? await connection.getMinimumBalanceForRentExemption(SPL_TOKEN_ACCOUNT_SPACE) : 0;
    const requiredLamports = estimateSponsorshipLamportsCost(instructions, message.header.numRequiredSignatures, tokenAccountRentExemptLamports);
    const actualBalance = await connection.getBalance(payerKey, 'confirmed');

    if (actualBalance < requiredLamports) {
      const particleSigner: SolanaTransactionSigner = {
        publicKey: payerKey,
        sign: async tx => {
          const {signSolanaTransactionViaParticle} = await import('../wallet/particleSigning.ts');
          const signedBytes = await signSolanaTransactionViaParticle(tx.serialize());
          return VersionedTransaction.deserialize(signedBytes);
        },
      };
      try {
        return await signAndSendSponsoredSolanaStep(instructions, lookupTables, particleSigner, connection, spendIntent);
      } catch (sponsorErr) {
        const sponsorMessage = sponsorErr instanceof Error ? sponsorErr.message : String(sponsorErr);
        throw new Error(
          `This wallet has ~${(actualBalance / 1e9).toFixed(4)} SOL, short of the ~${(requiredLamports / 1e9).toFixed(4)} SOL this route needs, and fee sponsorship didn't cover it: ${sponsorMessage}`,
        );
      }
    }
  } catch (err) {
    // A failure in the BALANCE CHECK itself (an RPC hiccup reading
    // getBalance/getMinimumBalanceForRentExemption, say) is not the same
    // as a confirmed shortfall — falls through to the normal path below
    // rather than wrongly assuming insufficient funds. A genuine
    // shortfall's own sponsorship failure (the throw inside the try
    // above) is a real, final error and must propagate, not be
    // swallowed here.
    if (err instanceof Error && /^This wallet has ~/.test(err.message)) throw err;
  }

  // Never hand Particle a transaction the spend guard couldn't verify.
  if (!spendVerified) {
    throw new Error("This wallet doesn't have enough SOL for this route's network fees, and fee sponsorship couldn't be checked — try again in a moment.");
  }
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

// Real gap this closes: a multi-step Relay quote (more than one
// transaction to sign/broadcast) that fails on step 2+ used to just
// throw, discarding every hash already pushed onto the local txHashes
// array from steps that landed for real on-chain — a caller's catch
// block only ever saw the error, never what had already gone through.
// That's the exact same "moved for real but no record of it" gap
// TokenTradeScreen.tsx's own consolidateIntoPayOrigin closed for its
// own multi-leg loop; this closes it at the source, for every caller.
//
// Deliberately a property tagged onto the SAME thrown error object
// (never a new Error wrapping it) — preserves the original's identity
// exactly, so every existing `instanceof TransactionIntentError` (or
// any other) check downstream keeps working unchanged. Purely additive
// metadata, not a new control-flow path.
const PARTIAL_TX_HASHES_KEY = 'mangoPartialTxHashes';

function attachPartialTxHashes(err: unknown, hashes: string[]): void {
  if (hashes.length === 0 || !err || typeof err !== 'object') return;
  (err as Record<string, unknown>)[PARTIAL_TX_HASHES_KEY] = hashes;
}

/** Reads back the hashes attachPartialTxHashes recorded, or an empty array if this error never carried any (the common case — most failures happen before anything broadcasts). */
export function getPartialTxHashes(err: unknown): string[] {
  if (!err || typeof err !== 'object') return [];
  const value = (err as Record<string, unknown>)[PARTIAL_TX_HASHES_KEY];
  return Array.isArray(value) ? value.filter((h): h is string => typeof h === 'string') : [];
}

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

  // This whole quote spends from exactly one origin currency (Relay's
  // own currencyIn) — read once here and threaded into every EVM step
  // sender below purely as an allowance-recovery fallback (see
  // toppedUpOriginAllowance's own header): a real, reproduced BNB Chain
  // Convert failure (TransferFromFailed() on Relay's Depository) traced
  // to the deposit step pulling this exact token without enough prior
  // approval. Left undefined (recovery becomes a no-op) whenever the
  // origin is a native coin, not an ERC-20 — matches this codebase's own
  // zero-address native placeholder (chainData.ts's NATIVE_TOKEN_ADDRESS).
  const originCurrencyAddress = quote.details?.currencyIn?.currency?.address;
  const originToken =
    originCurrencyAddress && originCurrencyAddress.toLowerCase() !== '0x0000000000000000000000000000000000000000'
      ? (originCurrencyAddress as `0x${string}`)
      : undefined;
  const originAmountRaw = quote.details?.currencyIn?.amount;
  let originAmount: bigint | undefined;
  try {
    originAmount = originAmountRaw ? BigInt(originAmountRaw) : undefined;
  } catch {
    originAmount = undefined;
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

  // Diagnostic only, no effect on execution — kept from when a Base
  // Convert reverted on the Depository with no decodable reason. Since
  // resolved: Relay's own EVM Depository Reference (its real Solidity
  // API docs) confirms depositErc20 does a plain, direct
  // transferFrom(msg.sender, address(this), amount) — no Permit2
  // anywhere in it, ruling out the "different spender" guess this
  // comment used to make. The actual gap (see sendRelayEvmStepSponsored's
  // own header on its broadcast-time recovery) was that Pimlico's
  // bundler runs its own separate simulation during the real broadcast,
  // which can catch a revert this function's own pre-flight simulate
  // missed — and until that broadcast-time recovery was added, such a
  // revert never got a chance at allowance-recovery at all. Left in
  // place since it costs nothing and is still useful for diagnosing
  // anything else pendingItems might reveal in the future.
  console.warn(
    '[executeRelayQuote] pendingItems:',
    pendingItems.map(item => ({
      chainId: item.data?.chainId,
      to: item.data?.to,
      selector: typeof item.data?.data === 'string' ? item.data.data.slice(0, 10) : undefined,
      value: item.data?.value,
    })),
  );

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

  try {
    for (const item of pendingItems) {
      if (isSolanaShaped(item)) {
        const spendIntent = solanaSpendIntentFor(tagged.intent);
        const {signature, warnings: solanaStepWarnings} = isGoogleSession
          ? await signAndSendRelaySolanaStepViaParticle(item, session.solana.address, spendIntent)
          : await signAndSendRelaySolanaStep(item, session.solana.privateKey, spendIntent);
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
        // No sponsored client on a chain gasless is off for (Arc): the
        // dispatch below then takes the plain-transaction path.
        const gaslessOnThisChain: boolean = useGasless && isGaslessSupportedOnChain(chainId);
        const sponsoredClient: Awaited<ReturnType<typeof getSponsoredSmartAccountClient>> | null = owner && gaslessOnThisChain ? await getSponsoredSmartAccountClient({chain: viemChain, owner}) : null;
        evmClients = {walletClient, publicClient, sponsoredClient};
      }
      let hash: string;
      if (isGoogleSession) {
        hash = await sendRelayEvmStepViaParticle(session.evm.address as `0x${string}`, evmClients.publicClient, chainId, item, originToken, originAmount);
      } else if (useGasless && evmClients.sponsoredClient) {
        try {
          hash = await sendRelayEvmStepSponsored(evmClients.sponsoredClient, evmClients.publicClient, item, originToken, originAmount);
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
              hash = await sendRelayEvmStepSponsored(evmClients.sponsoredClient, evmClients.publicClient, item, originToken, originAmount);
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
              hash = await fallBackToPlainTransaction(evmClients.walletClient!, evmClients.publicClient, item, originToken, originAmount);
            }
          } else {
            console.warn('[smartAccount] Sponsored UserOperation rejected before broadcast, falling back to a plain transaction:', message);
            hash = await fallBackToPlainTransaction(evmClients.walletClient!, evmClients.publicClient, item, originToken, originAmount);
          }
        }
      } else {
        hash = await sendRelayEvmStep(evmClients.walletClient!, evmClients.publicClient, item, originToken, originAmount);
      }
      txHashes.push(hash);
    }
  } catch (err) {
    // See attachPartialTxHashes's own header above — tags the SAME
    // error object with whatever hashes already landed before this
    // step failed, never replacing or rewrapping it.
    attachPartialTxHashes(err, txHashes);
    throw err;
  }

  if (requestId) {
    onStep?.('filling');
    await pollRelayStatus(requestId);
  }
  onStep?.('done');
  return {txHashes, warnings};
}
