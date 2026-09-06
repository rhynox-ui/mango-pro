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
// Solana is NOT covered here. rn-auth-core's solana.signAndSendTransaction
// takes a transaction string too, but no bundled reference code in
// either the current or the previous Particle SDK covers what encoding
// it expects, and Particle's docs sites are unreachable from this
// sandbox to confirm it independently. Signing a real transaction with
// unconfirmed wire format risks either a loud native decode error (the
// safe failure) or, worse, an untested/misencoded payload doing
// something unintended — not a risk worth taking with real funds.
// Solana trades/withdrawals for Google sessions stay refused (see
// TokenTradeScreen.tsx / ProfileScreen.tsx's own gates) until that's
// verified against a real device and Particle's own confirmation.

import {evm} from '@particle-network/rn-auth-core';

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
