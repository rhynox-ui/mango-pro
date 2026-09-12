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
// This is additive and opt-in: nothing here is wired into live trading
// yet (see executeRelayQuote.ts). A user who never opts in keeps
// trading exactly as today, holding native gas on whichever chain they
// spend from.
//
// Verified against the actually-installed permissionless@0.4.1 types
// (node_modules/permissionless/_types), not copied from docs that may
// be stale — this session's own network sandbox couldn't reach
// docs.pimlico.io to confirm the current guide directly, so the real
// installed .d.ts files were read instead. Two things confirmed this
// way, not assumed: (1) to7702SimpleSmartAccount's own parameter type
// requires EntryPoint v0.8 specifically when eip7702 delegation is used
// — permissionless's ToSimpleSmartAccountParameters type enforces this
// at the type level, not v0.7 as an older example elsewhere suggested;
// (2) createSmartAccountClient's `paymaster` field accepts an object
// exposing getPaymasterData/getPaymasterStubData, which the Pimlico
// client returned by createPimlicoClient satisfies structurally.
//
// PIMLICO_API_KEY below is real (the account owner's own "Mango-protocol"
// key from dashboard.pimlico.io, free tier) — same plain-constant
// pattern RELAY_API_KEY already uses in relayQuote.ts, since this
// codebase has no build-time env-var system. Still unproven end-to-end:
// having a real key means the network call can now actually be made,
// not that a sponsored UserOperation has been confirmed to land — that
// still needs the isolated test screen this file's own header calls
// for, before executeRelayQuote.ts touches any of this.

import {createPublicClient, http, type Chain, type LocalAccount} from 'viem';
import {entryPoint08Address} from 'viem/account-abstraction';
import {to7702SimpleSmartAccount} from 'permissionless/accounts';
import {createPimlicoClient} from 'permissionless/clients/pimlico';
import {createSmartAccountClient} from 'permissionless';

const PIMLICO_API_KEY = 'pim_N9WghP1RNn1eZ5nnFrFyKi';

const ENTRY_POINT = {address: entryPoint08Address, version: '0.8'} as const;

function pimlicoUrl(chain: Chain): string {
  return `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${PIMLICO_API_KEY}`;
}

/** False until a real Pimlico API key is set above — callers should check this before offering "gasless trading" in the UI, same pattern as Relay's own sponsorshipActive check in relayQuote.ts. */
export function isSmartAccountSponsorshipConfigured(): boolean {
  return PIMLICO_API_KEY.length > 0;
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

  const publicClient = createPublicClient({chain, transport: http()});
  const account = await to7702SimpleSmartAccount({client: publicClient, owner, entryPoint: ENTRY_POINT});

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
