// src/core/evmSigner.ts
//
// Shared write-path abstraction for the fallback-DEX modules
// (uniswapV3.ts, uniswapV4.ts, sushiswapV2.ts, pancakeswapV3.ts) and
// fallbackDex.ts's own executeFallbackQuote/sweepFallbackFeeFromNativeBalance
// — six call sites that all independently built a viem walletClient
// from a raw privateKeyHex and called walletClient.writeContract(...)
// directly. A Google-login session has no privateKey to do that with
// (see keys.ts/particleAuth.ts) — this is the one place all six branch
// between a local seed-phrase account and a Particle MPC session,
// instead of each duplicating the branch. Same "separate, additive
// path — zero behavior change for the existing local-signing case"
// discipline already used for executeRelayQuote.ts/sendUsdc.ts's own
// Particle wiring.

import {createPublicClient, createWalletClient, encodeFunctionData, type Abi, type PublicClient, type WalletClient} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {transportFor, viemChainForChainId} from './chainRegistry.ts';
import type {DerivedAccounts} from '../wallet/keys';

export type EvmSigner =
  | {kind: 'local'; address: `0x${string}`; walletClient: WalletClient}
  | {kind: 'particle'; address: `0x${string}`; chainId: number};

/** Builds the signer + a publicClient for one chain from a session — local walletClient for a seed-phrase session, a Particle-backed signer for a Google session. */
export function signerAndPublicClientForChain(chainId: number, session: DerivedAccounts): {signer: EvmSigner; publicClient: PublicClient} {
  const viemChain = viemChainForChainId(chainId);
  if (!viemChain) throw new Error(`No EVM chain configured for chain id ${chainId}.`);
  const transport = transportFor(chainId);
  const publicClient = createPublicClient({chain: viemChain, transport});
  if (session.authMethod === 'google') {
    return {signer: {kind: 'particle', address: session.evm.address as `0x${string}`, chainId}, publicClient};
  }
  const account = privateKeyToAccount(session.evm.privateKey as `0x${string}`);
  const walletClient = createWalletClient({account, chain: viemChain, transport});
  return {signer: {kind: 'local', address: account.address, walletClient}, publicClient};
}

/**
 * Same effect as viem's own walletClient.writeContract (encode the
 * call, send it, return the hash) but works for either signer kind.
 * Loosely typed on purpose — abi/functionName/args aren't checked
 * against each other at this call site the way a direct
 * walletClient.writeContract(...) call is, since every real call site
 * already builds its own strictly-typed `as const` ABI and passes
 * matching args; this wrapper's job is only to route to the right
 * signing path, not to re-verify shapes already correct at the source.
 * Dynamic import of particleSigning.ts for the same reason
 * executeRelayQuote.ts/sendUsdc.ts already do it: keeps
 * @particle-network/rn-auth-core's react-native dependency out of any
 * plain-Node path that never needs it.
 */
export async function writeContractAs(signer: EvmSigner, req: {address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint}): Promise<`0x${string}`> {
  if (signer.kind === 'local') {
    return signer.walletClient.writeContract({account: signer.walletClient.account!, chain: signer.walletClient.chain, ...req} as never);
  }
  const {sendEvmTransactionViaParticle} = await import('../wallet/particleSigning.ts');
  const data = encodeFunctionData({abi: req.abi, functionName: req.functionName, args: req.args} as never);
  return sendEvmTransactionViaParticle(signer.address, {chainId: signer.chainId, to: req.address, data, value: req.value});
}

/**
 * Same effect as viem's own walletClient.sendTransaction, for a raw
 * (non-ABI-call) transaction — fallbackDex.ts's own generic-provider
 * swap (arbitrary calldata from a third-party quote) and its fee
 * sweep (a plain native transfer, no data at all) both need this
 * rather than writeContractAs above.
 */
export async function sendTransactionAs(signer: EvmSigner, req: {to: `0x${string}`; data?: `0x${string}`; value?: bigint; gas?: bigint}): Promise<`0x${string}`> {
  if (signer.kind === 'local') {
    return signer.walletClient.sendTransaction({account: signer.walletClient.account!, chain: signer.walletClient.chain, ...req} as never);
  }
  const {sendEvmTransactionViaParticle} = await import('../wallet/particleSigning.ts');
  return sendEvmTransactionViaParticle(signer.address, {chainId: signer.chainId, to: req.to, data: req.data, value: req.value});
}
