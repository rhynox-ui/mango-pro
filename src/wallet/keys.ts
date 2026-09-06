// src/wallet/keys.ts
//
// Ported (typed) from mango-mobile's own src/wallet/keys.js — same
// derivation, same libraries, same reasoning: EVM via viem/accounts'
// HDKey + privateKeyToAddress (this app already carries viem for
// swap/routing, so pulling in ethers just for HD derivation would be
// pure duplicate bundle weight); Solana via slip10Ed25519.ts instead of
// the `ed25519-hd-key` npm package, because that package calls Node's
// `crypto.createHmac`, unavailable under Hermes.
//
// EVM:    m/44'/60'/0'/0/{index}
// Solana: m/44'/501'/{index}'/0'
//
// mango-mobile's own scripts/verify-wallet-crypto.mjs already proves
// this exact algorithm derives byte-identical addresses to the site/
// extension for the standard test mnemonic — this is the same code, not
// a reimplementation, so that proof carries over rather than needing to
// be redone here.

import * as bip39 from 'bip39';
import {HDKey, privateKeyToAddress} from 'viem/accounts';
import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
import {derivePath} from './slip10Ed25519.ts';

export const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";
export const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

export const BIP39_WORDLIST = bip39.wordlists.english;

export type ChainAccount = {address: string; privateKey: string};
export type DerivedAccounts = {evm: ChainAccount; solana: ChainAccount};

/** Up to `limit` real BIP-39 words starting with `prefix` (case-insensitive). */
export function suggestBip39Words(prefix: string, limit = 5): string[] {
  const normalized = prefix.trim().toLowerCase();
  if (!normalized) return [];
  const out: string[] = [];
  for (const word of BIP39_WORDLIST) {
    if (word.startsWith(normalized)) {
      out.push(word);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function evmDerivationPathForIndex(index: number): string {
  return `m/44'/60'/0'/0/${index}`;
}
export function solanaDerivationPathForIndex(index: number): string {
  return `m/44'/501'/${index}'/0'`;
}

/** 12-word mnemonic — 128 bits of entropy, same as the site/extension/mobile. */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
}

export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ');
}

export function isValidMnemonic(phrase: string): boolean {
  return bip39.validateMnemonic(normalizeMnemonic(phrase));
}

/**
 * Derives both chains' accounts at a given HD index from one mnemonic.
 * Returns raw private keys — callers must never log, persist, or
 * transmit the return value.
 */
export function deriveAccountAtIndex(mnemonic: string, index: number): DerivedAccounts {
  const normalized = normalizeMnemonic(mnemonic);
  if (!bip39.validateMnemonic(normalized)) {
    throw new Error('Invalid recovery phrase — check the word order and spelling.');
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Account index must be a non-negative integer.');
  }

  const seed = bip39.mnemonicToSeedSync(normalized);
  const seedHex = Buffer.from(seed).toString('hex');

  const evmHdKey = HDKey.fromMasterSeed(seed).derive(evmDerivationPathForIndex(index));
  const evmPrivateKey = `0x${Buffer.from(evmHdKey.privateKey!).toString('hex')}` as `0x${string}`;
  const evmAddress = privateKeyToAddress(evmPrivateKey);

  const {key} = derivePath(solanaDerivationPathForIndex(index), seedHex);
  const solanaKeypair = Keypair.fromSeed(key);

  return {
    evm: {address: evmAddress, privateKey: evmPrivateKey},
    solana: {address: solanaKeypair.publicKey.toBase58(), privateKey: bs58.encode(solanaKeypair.secretKey)},
  };
}

/** Account 0 — the wallet's default identity. */
export function deriveAccounts(mnemonic: string): DerivedAccounts {
  return deriveAccountAtIndex(mnemonic, 0);
}

// Both @noble/curves-backed curves used above (secp256k1 for EVM via
// viem/accounts, ed25519 for Solana via @solana/web3.js) do a real
// one-time precomputation the first time they're used in the app's
// lifetime. Call this once, early (App.tsx does) so the real derivation
// at onboarding handoff is already warm rather than paying that cost
// synchronously at the worst possible moment. Best-effort only — never
// let a warmup failure surface to the user.
export function warmupCrypto(): void {
  try {
    const dummySeed = new Uint8Array(32).fill(7);
    const hd = HDKey.fromMasterSeed(dummySeed).derive(EVM_DERIVATION_PATH);
    privateKeyToAddress(`0x${Buffer.from(hd.privateKey!).toString('hex')}` as `0x${string}`);
    Keypair.fromSeed(dummySeed);
  } catch {
    // best-effort — see comment above
  }
}
