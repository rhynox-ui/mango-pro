// src/wallet/particleSigning.ts
//
// Real EVM transaction signing for Google-login (Particle MPC) sessions
// — Phase 2 of particleAuth.ts's own two-phase plan. A Google session's
// DerivedAccounts carries a real address but a deliberately empty
// privateKey (see keys.ts/particleAuth.ts's own headers for why one
// can't exist here at all), so every EVM signing call site that used to
// reach straight for session.evm.privateKey needs a second path that
// signs through Particle's own MPC infrastructure instead.
//
// Wire format confirmed directly from @particle-network/rn-auth-core's
// own bundled reference EIP-1193 provider (src/provider/index.ts,
// its eth_sendTransaction handling) — not guessed: a standard
// eth_sendTransaction params object (to/data/value/chainId, values as
// 0x-prefixed hex strings), JSON.stringify'd, then hex-encoded with a
// 0x prefix. evm.sendTransaction() already returns the broadcast tx
// hash directly (its own promise wrapper resolves/rejects off
// Particle's native {status,data} callback), so no result-object
// unwrapping is needed here despite the reference provider code above
// doing one — that's specific to how the EIP-1193 layer treats its own
// call to evm.sendTransaction, not evm.sendTransaction's real contract.
//
// Solana's wire format is now confirmed too, from two independent real
// sources (not the same guess repeated twice):
//  1. Particle's own official Android AuthCore demo (github.com/
//     Particle-Network/particle-android, app/.../TransactionMock.kt) —
//     mockSolanaTransaction() calls ParticleNetwork.solana.serializeTransaction(...)
//     and passes its result.transaction.serialized STRING straight into
//     AuthCore.solana's own signing calls, unmodified. The same
//     result.transaction.serialized shape appears identically in the
//     older @particle-network/rn-auth's own SolanaService.ts
//     (enhancedSerializeTransaction) and in the unrelated Particle
//     Connect Android demo — three independent code paths agreeing on
//     the same field.
//  2. Particle's own current React Native docs (developers.particle.network/
//     social-logins/auth/mobile-sdks/react — unreachable for a direct
//     fetch from this sandbox, but the exact page text was independently
//     retrieved and relayed) state plainly that solana.signTransaction/
//     signAllTransactions/signAndSendTransaction all require a Base58
//     string, not a transaction object — consistent with this app
//     already depending on bs58 for Solana addresses/keys elsewhere.
// signAndSendSolanaTransactionViaParticle below builds on both: bs58-
// encode a real, locally-built @solana/web3.js transaction (this app's
// own existing Solana code, e.g. sendUsdc.ts's sendSolanaUsdc, already
// builds these the normal way) rather than depending on Particle's own
// serializeTransaction RPC, which only covers a few fixed operation
// shapes (plain SOL/SPL transfers) and couldn't carry an arbitrary
// Relay-quoted instruction set.
//
// Wired into real Solana trading (executeRelayQuote.ts) and withdrawal
// (sendUsdc.ts) at the account owner's explicit, informed instruction —
// against this file's own original plan to prove the encoding on a
// real device via SolanaDevnetTestScreen.tsx first. That devnet test
// still exists (Settings > "Solana signing test") and is the fastest
// way to confirm this path independently of a real trade; it was not
// run before this went live. If Particle's Base58 requirement turns
// out subtly wrong in some case this file's own sources didn't cover,
// the failure mode is whatever Particle's native SDK does with a
// malformed payload — flagged here, not silently assumed safe.

import bs58 from 'bs58';
import {evm, solana} from '@particle-network/rn-auth-core';

export type ParticleEvmTxRequest = {
  chainId: number;
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
};

/**
 * Signs and broadcasts one EVM transaction through Particle's MPC
 * signer, returning the tx hash. `from` isn't sent to Particle (it
 * already knows which account is logged in) — it's accepted here only
 * so call sites read the same way as the local-signing path they sit
 * beside.
 */
export async function sendEvmTransactionViaParticle(_from: `0x${string}`, req: ParticleEvmTxRequest): Promise<`0x${string}`> {
  const txData: Record<string, string> = {
    to: req.to,
    chainId: `0x${req.chainId.toString(16)}`,
  };
  if (req.data) txData.data = req.data;
  if (req.value !== undefined) txData.value = `0x${req.value.toString(16)}`;
  const json = JSON.stringify(txData);
  const hexPayload = `0x${Buffer.from(json, 'utf8').toString('hex')}`;
  const hash = await evm.sendTransaction(hexPayload);
  return hash as `0x${string}`;
}

/**
 * Signs and broadcasts a real Solana transaction through Particle's MPC
 * signer. Takes the raw serialized bytes (from a normal
 * @solana/web3.js Transaction/VersionedTransaction .serialize() call —
 * see this file's own header for why bs58 is the right encoding) and
 * bs58-encodes them here, so every call site passes the same plain
 * bytes it already builds today for the local-signing path, not a
 * Particle-specific format.
 *
 * DEVNET-PROVEN ONLY as of this writing (see
 * SolanaDevnetTestScreen.tsx) — not yet called from any real trading or
 * withdrawal path.
 */
export async function signAndSendSolanaTransactionViaParticle(serializedTransaction: Uint8Array): Promise<string> {
  const base58Transaction = bs58.encode(serializedTransaction);
  return solana.signAndSendTransaction(base58Transaction);
}
