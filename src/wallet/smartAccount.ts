// src/wallet/smartAccount.ts
//
// EIP-7702 gas-sponsorship spike (Phase 0, ARCHITECTURE.md §1). Closes
// the one real remaining gap between Mango Pro's already-working
// Relay-based cross-chain trading and FOMO's experience: origin-chain
// EVM gas. Relay's Depository contract already accepts deposits from a
// plain EOA today (confirmed against Relay's own docs — this file
// doesn't change how Relay itself is called), it just costs the user
// two signed transactions (approve, then depositErc20) paid in native
// gas. EIP-7702 lets that SAME EOA — same address, no migration, no new
// counterfactual account — temporarily delegate to a smart-account
// implementation so Pimlico can batch those two calls into one
// sponsored UserOperation instead.
//
// This is additive and opt-in (Security settings' "Gasless trading
// (beta)" toggle, gaslessTradingPrefs.ts): a user who never opts in
// keeps trading exactly as today, holding native gas on whichever chain
// they spend from.
//
// A real trade hit Pimlico's bundler rejecting a UserOperation
// ("Invalid fields set on User Operation") — root-caused by reading the
// ACTUAL installed source, not guessed: this file builds the 7702
// account via permissionless's to7702SimpleSmartAccount, which asks
// viem's own automatic UserOperation-preparation path to attach an
// EIP-7702 authorization when the EOA hasn't delegated on this chain
// yet. But the installed viem version's automatic path
// (node_modules/viem/account-abstraction/actions/bundler/
// prepareUserOperation.ts) only ever produces a STUB authorization —
// hardcoded, structurally-fake r/s/yParity bytes meant for gas
// estimation — UNLESS the caller passes a real, already-signed
// `authorization` explicitly. Nothing in this file (or
// executeRelayQuote.ts) was doing that, so every first-ever sponsored
// UserOperation for a not-yet-delegated EOA carried a signature that
// could never recover to the right address — exactly what a bundler's
// field validation rejects as "invalid fields", before the UserOp is
// ever included.
//
// Fixed by getEip7702AuthorizationIfNeeded below: sign a REAL
// authorization with viem's own signAuthorization (using the exact same
// owner key and delegation target permissionless's account object
// already carries at account.authorization) whenever the EOA isn't
// deployed/delegated on this chain yet, and hand it to sendTransaction
// explicitly. permissionless's own sendTransaction (actions/smartAccount
// /sendTransaction.ts) forwards any extra field straight through to
// viem's sendUserOperation, which uses a caller-supplied `authorization`
// as-is (`typeof parameters.authorization === 'object'`) instead of
// asking prepareUserOperation to fabricate one — confirmed by reading
// both files directly, not assumed from either library's docs.
// executeRelayQuote.ts's own fallback-to-plain-transaction on a
// pre-broadcast rejection stays in place regardless, as a second layer:
// this fix should make that fallback path stop firing for this
// specific reason, not a replacement for having it.
//
// Verified against the actually-installed permissionless@0.4.1 and
// viem@2.56.3 source (node_modules), not copied from docs that may be
// stale or refer to a different version — this session's own network
// sandbox couldn't reach docs.pimlico.io to confirm the current guide
// directly, so the real installed source was read instead. Also
// confirmed this way: (1) to7702SimpleSmartAccount's own parameter type
// requires EntryPoint v0.8 specifically when eip7702 delegation is used;
// (2) createSmartAccountClient's `paymaster` field accepts an object
// exposing getPaymasterData/getPaymasterStubData, which the Pimlico
// client returned by createPimlicoClient satisfies structurally;
// (3) SIMPLE_7702_ACCOUNT_IMPLEMENTATION below is permissionless's own
// default accountLogicAddress for EntryPoint 0.8 (toSimpleSmartAccount.ts),
// pinned explicitly here (passed to to7702SimpleSmartAccount) rather
// than left as an unread default, so this file has one place that both
// builds the account AND signs its authorization against the exact same
// address.
//
// PIMLICO_API_KEY below is real (the account owner's own "Mango-protocol"
// key from dashboard.pimlico.io, free tier) — same plain-constant
// pattern RELAY_API_KEY already uses in relayQuote.ts, since this
// codebase has no build-time env-var system.

import {createPublicClient, http, type Chain, type LocalAccount} from 'viem';
// This installed viem version's root export only re-exports
// signAuthorization's TYPES, not the function itself (confirmed by
// reading node_modules/viem/index.ts directly) — the real function
// lives at the 'viem/actions' subpath instead.
import {signAuthorization} from 'viem/actions';
import {entryPoint08Address} from 'viem/account-abstraction';
import {to7702SimpleSmartAccount} from 'permissionless/accounts';
import {createPimlicoClient} from 'permissionless/clients/pimlico';
import {createSmartAccountClient} from 'permissionless';

// Rotated after an uploaded security audit's MANGO-C02 finding confirmed
// the previous key (pim_N9Wgh...) was a live, embedded client secret —
// the old key was revoked on Pimlico's dashboard before this replacement
// landed. Embedding a key here at all is still the same real exposure
// the audit flagged (any React Native bundle ships this string readably
// unless minification/R8 is enabled — see MANGO-M02, also not yet
// closed); moving Pimlico calls behind mango-api so the client never
// holds this key is the real fix, tracked separately, not done here.
const PIMLICO_API_KEY = 'pim_JRJAkD756rxN2xZvJ6Lb5z';

const ENTRY_POINT = {address: entryPoint08Address, version: '0.8'} as const;

const SIMPLE_7702_ACCOUNT_IMPLEMENTATION = '0xe6Cae83BdE06E4c305530e199D7217f42808555B' as const;

function pimlicoUrl(chain: Chain): string {
  return `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${PIMLICO_API_KEY}`;
}

/** False until a real Pimlico API key is set above — callers should check this before offering "gasless trading" in the UI, same pattern as Relay's own sponsorshipActive check in relayQuote.ts. */
export function isSmartAccountSponsorshipConfigured(): boolean {
  return PIMLICO_API_KEY.length > 0;
}

// Arc (5042) pays gas in USDC natively, so sponsoring it saves the user
// no second token, and Pimlico's bundler + EIP-7702 support there is not
// verified. Arc always takes the plain-transaction path.
const GASLESS_UNSUPPORTED_CHAIN_IDS = new Set<number>([5042]);

/** Whether the Pimlico gasless path may be used on this chain at all — checked alongside isSmartAccountSponsorshipConfigured(). */
export function isGaslessSupportedOnChain(chainId: number): boolean {
  return !GASLESS_UNSUPPORTED_CHAIN_IDS.has(chainId);
}

/**
 * Builds a Pimlico-sponsored smart-account client for one EVM chain,
 * delegating the given EOA (`owner`) to a 7702-compatible simple
 * account. Call sites send UserOperations through the returned client
 * (e.g. batching approve+depositErc20 into Relay's real Depository
 * contract, using the exact calldata Relay's own quote already
 * returns — this module only changes how that calldata gets signed and
 * who pays its gas, never what it says) instead of a plain wallet
 * transaction.
 */
export async function getSponsoredSmartAccountClient({chain, owner}: {chain: Chain; owner: LocalAccount}) {
  if (!isSmartAccountSponsorshipConfigured()) {
    throw new Error("Gasless trading isn't configured yet (missing Pimlico API key).");
  }
  if (!isGaslessSupportedOnChain(chain.id)) {
    throw new Error(`Gasless trading isn't available on ${chain.name}.`);
  }

  const publicClient = createPublicClient({chain, transport: http()});
  const account = await to7702SimpleSmartAccount({
    client: publicClient,
    owner,
    entryPoint: ENTRY_POINT,
    accountLogicAddress: SIMPLE_7702_ACCOUNT_IMPLEMENTATION,
  });

  const pimlicoClient = createPimlicoClient({
    chain,
    transport: http(pimlicoUrl(chain)),
    entryPoint: ENTRY_POINT,
  });

  return createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(pimlicoUrl(chain)),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });
}

/**
 * Signs a REAL EIP-7702 authorization (never the automatic stub — see
 * this file's own header) when the EOA hasn't delegated to the smart
 * account implementation on this specific chain yet. Returns undefined
 * once delegated (the account already has code there, so no
 * authorization is needed on subsequent transactions) — safe to call on
 * every sponsored transaction regardless of delegation state.
 *
 * `publicClient` here is only used for the authorization's own
 * nonce/chainId lookup (viem's prepareAuthorization) — it can be the
 * same publicClient the caller already built for simulate/receipt
 * calls, no separate client needed.
 */
export async function getEip7702AuthorizationIfNeeded(
  client: Awaited<ReturnType<typeof getSponsoredSmartAccountClient>>,
  publicClient: ReturnType<typeof createPublicClient>,
) {
  if (await client.account.isDeployed()) return undefined;
  return signAuthorization(publicClient, {
    account: client.account.authorization.account,
    contractAddress: client.account.authorization.address,
  });
}
