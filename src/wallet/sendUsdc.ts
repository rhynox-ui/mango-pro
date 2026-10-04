// src/wallet/sendUsdc.ts
//
// Real, non-custodial "cash" send — the "Withdraw -> Crypto wallet" path
// FOMO's own reference screenshot shows ("Withdraw USDC to a supported
// network"). Scoped port of mango-mobile's src/wallet/sendTransaction.js
// ERC-20/SPL transfer functions, cut down to exactly this app's real
// per-chain cash asset (see usdcBalances.ts's own CASH_ASSET_BY_CHAIN
// header) rather than the general any-token sender mobile needs.
//
// USDC on every chain except one: Robinhood Chain's own real cash asset
// is USDG, not USDC (no USDC contract exists there at all), so this
// file sends whichever one actually applies — the ERC-20 transfer()
// call is identical either way, only the token contract address and
// decimals differ. Solana stays USDC-only; there's no USDG there in
// this app's own verified data.
//
// EVM cash movement is Relay-sponsored: Mango never silently turns a
// gasless withdrawal into a native-gas ERC-20 transfer. Local-seed EVM
// sessions sign the Relay gasless authorization/call; Google sessions
// still use Particle's native EVM signing surface because Particle RN does
// not expose the EIP-7702 authorization primitive required by Mango's
// Relay gasless EVM executor.

import {encodeFunctionData, parseUnits, isAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import bs58 from 'bs58';
import {getViemChain} from '../core/chainRegistry.ts';
import {TOKEN_ADDRESSES, ASSET_ONCHAIN_DECIMALS, assetDecimalsForChain, type ChainKey} from '../core/chainData.ts';
import {sendEvmCallsViaRelayGasless} from '../core/relayGaslessEvm.ts';
import {signAndSendSponsoredSolanaStep, type SolanaTransactionSigner} from '../core/executeRelayQuote.ts';
import type {DerivedAccounts} from './keys';

const USDC_DECIMALS = ASSET_ONCHAIN_DECIMALS.USDC;
type CashAsset = 'USDC' | 'USDG';

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      {name: 'to', type: 'address'},
      {name: 'amount', type: 'uint256'},
    ],
    outputs: [{type: 'bool'}],
    stateMutability: 'nonpayable',
  },
] as const;

export function isValidRecipientAddress(chainKey: ChainKey, address: string): boolean {
  if (chainKey === 'solana') {
    // Same shape check @solana/web3.js's own PublicKey constructor
    // enforces (base58, decodes to exactly 32 bytes) — checked directly
    // via bs58 (already a plain-JS dependency here) rather than
    // importing the whole SDK just to validate a string as it's typed.
    try {
      return bs58.decode(address).length === 32;
    } catch {
      return false;
    }
  }
  return isAddress(address);
}

async function sendEvmCashAsset(chainKey: ChainKey, asset: CashAsset, session: DerivedAccounts, toAddress: string, amount: string, useGaslessTrading: boolean): Promise<{hash: string}> {
  const tokenAddress = TOKEN_ADDRESSES[asset]?.[chainKey];
  if (!tokenAddress) throw new Error(`No verified ${asset} address for ${chainKey}.`);
  const chain = getViemChain(chainKey);
  const fromAddress = session.evm.address as `0x${string}`;

  const decimals = assetDecimalsForChain(chainKey, asset) ?? ASSET_ONCHAIN_DECIMALS[asset];
  const amountRaw = parseUnits(amount, decimals);
  const data = encodeFunctionData({abi: ERC20_TRANSFER_ABI, functionName: 'transfer', args: [toAddress as `0x${string}`, amountRaw]});

  // Google-login sessions carry no privateKey to build a viem
  // walletClient from at all (see keys.ts/particleAuth.ts) — sign
  // through Particle's own MPC path instead. Wire format confirmed in
  // particleSigning.ts's own header. Dynamic import, not a static one:
  // particleSigning.ts pulls in @particle-network/rn-auth-core, which
  // touches react-native's own NativeModules at module load — fine
  // under Metro, but this file is also imported directly by
  // scripts/verify-send-usdc.mjs's plain-Node offline checks, which
  // never exercises this branch and shouldn't have to load
  // react-native at all just to import isValidRecipientAddress.
  if (session.authMethod === 'google') {
    const {sendEvmTransactionViaParticle} = await import('./particleSigning.ts');
    const hash = await sendEvmTransactionViaParticle(fromAddress, {chainId: chain.id, to: tokenAddress as `0x${string}`, data});
    return {hash};
  }

  const account = privateKeyToAccount(session.evm.privateKey as `0x${string}`);

  // Relay is the ONLY EVM execution provider for Mango's gasless cash
  // movement. A Relay rejection is a real execution failure — it is
  // never permission to silently switch to a user-paid native-gas
  // transfer. That fallback caused the "insufficient ETH for gas"
  // withdrawal failure: the wallet held USDC but no ETH, so viem tried
  // to execute transfer() directly and failed.
  //
  // Keep the old option in the signature for caller compatibility, but
  // it cannot disable Relay for cash movement. A withdrawal must not
  // unexpectedly become dependent on the chain's native gas token.
  void useGaslessTrading;
  const relay = await sendEvmCallsViaRelayGasless({
    chain,
    fromAddress,
    privateKey: session.evm.privateKey as `0x${string}`,
    calls: [{to: tokenAddress as `0x${string}`, data, value: 0n}],
  });
  return {hash: relay.hash};
}

async function sendSolanaUsdc(session: DerivedAccounts, toAddress: string, amountUsdc: string): Promise<{signature: string}> {
  const mintAddress = TOKEN_ADDRESSES.USDC.solana;
  if (!mintAddress) throw new Error('No verified USDC mint for solana.');
  const [
    {Connection, Keypair, PublicKey, Transaction},
    {getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction},
  ] = await Promise.all([import('@solana/web3.js'), import('@solana/spl-token')]);

  const connection = new Connection('https://rpc.solanatracker.io/public', 'confirmed');
  const fromKeypair = Keypair.fromSecretKey(bs58.decode(session.solana.privateKey));
  const mintPublicKey = new PublicKey(mintAddress);
  const toPublicKey = new PublicKey(toAddress);

  const fromAta = await getAssociatedTokenAddress(mintPublicKey, fromKeypair.publicKey);
  const toAta = await getAssociatedTokenAddress(mintPublicKey, toPublicKey);
  const toAtaInfo = await connection.getAccountInfo(toAta);

  const instructions = [];
  if (toAtaInfo === null) {
    // Recipient has no USDC token account yet — sender pays the one-time
    // rent to create it, same as every other Solana wallet's behavior;
    // there's no way to send an SPL token into an account that can't
    // hold it.
    instructions.push(createAssociatedTokenAccountInstruction(fromKeypair.publicKey, toAta, toPublicKey, mintPublicKey));
  }
  const amountRaw = parseUnits(amountUsdc, USDC_DECIMALS);
  instructions.push(createTransferInstruction(fromAta, toAta, fromKeypair.publicKey, amountRaw));

  const transaction = new Transaction();
  transaction.add(...instructions);
  const {blockhash, lastValidBlockHeight} = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromKeypair.publicKey;
  transaction.sign(fromKeypair);

  try {
    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction({signature, blockhash, lastValidBlockHeight}, 'confirmed');
    return {signature};
  } catch (err) {
    // Real gap this closes, same fix already shipped for trades: a
    // wallet with just enough USDC to withdraw but too little SOL for
    // the network fee (plus rent if the recipient needs a new token
    // account) used to fail outright here. sendRawTransaction's own
    // pre-flight simulation rejects BEFORE accepting into the mempool —
    // nothing broadcast yet — so it's safe to retry with Mango's own
    // fee-payer sponsoring the shortfall instead, reusing the exact same
    // rewrite/sign/co-sign/broadcast path (and its opportunistic,
    // never-blocking cost-recovery attempt) executeRelayQuote.ts already
    // built and tested for trades.
    const errorMessage = err instanceof Error ? err.message : String(err);
    const lamportsMatch = errorMessage.match(/insufficient lamports (\d+), need (\d+)/i);
    if (!lamportsMatch) throw err;
    try {
      const localSigner: SolanaTransactionSigner = {
        publicKey: fromKeypair.publicKey,
        sign: async tx => {
          tx.sign([fromKeypair]);
          return tx;
        },
      };
      // Same spend guard as trades: this withdrawal may move exactly the USDC entered.
      const {signature} = await signAndSendSponsoredSolanaStep(instructions, [], localSigner, connection, {spend: mintAddress, maxSpend: amountRaw});
      return {signature};
    } catch (sponsorErr) {
      const haveSol = Number(lamportsMatch[1]) / 1e9;
      const needSol = Number(lamportsMatch[2]) / 1e9;
      const sponsorMessage = sponsorErr instanceof Error ? sponsorErr.message : String(sponsorErr);
      throw new Error(
        `This wallet has ~${haveSol.toFixed(4)} SOL, short of the ~${needSol.toFixed(4)} SOL this withdrawal needs, and fee sponsorship didn't cover it: ${sponsorMessage}`,
      );
    }
  }
}

/**
 * Same ATA/transfer instruction assembly as sendSolanaUsdc above, but
 * for a Google-login session: no local secret key, so the built
 * (unsigned) transaction is serialized and handed to Particle's own MPC
 * signer instead, which signs AND broadcasts in one call. Fully
 * separate from the local-signing function above.
 */
async function sendSolanaUsdcViaParticle(session: DerivedAccounts, toAddress: string, amountUsdc: string): Promise<{signature: string}> {
  const mintAddress = TOKEN_ADDRESSES.USDC.solana;
  if (!mintAddress) throw new Error('No verified USDC mint for solana.');
  const [
    {Connection, PublicKey, Transaction},
    {getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction},
  ] = await Promise.all([import('@solana/web3.js'), import('@solana/spl-token')]);

  const connection = new Connection('https://rpc.solanatracker.io/public', 'confirmed');
  const fromPublicKey = new PublicKey(session.solana.address);
  const mintPublicKey = new PublicKey(mintAddress);
  const toPublicKey = new PublicKey(toAddress);

  const fromAta = await getAssociatedTokenAddress(mintPublicKey, fromPublicKey);
  const toAta = await getAssociatedTokenAddress(mintPublicKey, toPublicKey);
  const toAtaInfo = await connection.getAccountInfo(toAta);

  const transaction = new Transaction();
  if (toAtaInfo === null) {
    transaction.add(createAssociatedTokenAccountInstruction(fromPublicKey, toAta, toPublicKey, mintPublicKey));
  }
  const amountRaw = parseUnits(amountUsdc, USDC_DECIMALS);
  transaction.add(createTransferInstruction(fromAta, toAta, fromPublicKey, amountRaw));

  const {blockhash, lastValidBlockHeight} = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPublicKey;
  const serialized = transaction.serialize({requireAllSignatures: false, verifySignatures: false});

  const {signAndSendSolanaTransactionViaParticle} = await import('./particleSigning.ts');
  const signature = await signAndSendSolanaTransactionViaParticle(serialized);
  await connection.confirmTransaction({signature, blockhash, lastValidBlockHeight}, 'confirmed');
  return {signature};
}

/**
 * Sends this chain's real cash asset (USDC everywhere, USDG on
 * Robinhood Chain — see this file's own header) from the unlocked
 * session's own account, direct to the chain. `asset` defaults to
 * 'USDC' for every existing call site; pass CASH_ASSET_BY_CHAIN[chainKey]
 * explicitly to get the real one for chains where that's not USDC.
 *
 * `useGaslessTrading` (default false, caller's own gaslessTradingPrefs.ts
 * read — same as every other trade path) only affects the EVM branch's
 * OWN gas: Solana sponsorship is separate and automatic regardless of
 * this flag, exactly as it already is for trades — see sendSolanaUsdc's
 * own fee-payer fallback above.
 */
export async function sendUsdc(chainKey: ChainKey, session: DerivedAccounts, toAddress: string, amount: string, asset: CashAsset = 'USDC', useGaslessTrading = false): Promise<{txId: string}> {
  if (!isValidRecipientAddress(chainKey, toAddress)) {
    throw new Error(`That doesn't look like a valid ${chainKey === 'solana' ? 'Solana' : 'wallet'} address.`);
  }
  if (chainKey === 'solana') {
    // No USDG on Solana in this app's own verified data — always the
    // real USDC path here regardless of what's passed.
    const {signature} = session.authMethod === 'google' ? await sendSolanaUsdcViaParticle(session, toAddress, amount) : await sendSolanaUsdc(session, toAddress, amount);
    return {txId: signature};
  }
  const {hash} = await sendEvmCashAsset(chainKey, asset, session, toAddress, amount, useGaslessTrading);
  return {txId: hash};
}
