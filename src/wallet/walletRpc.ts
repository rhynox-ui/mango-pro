// src/wallet/walletRpc.ts
//
// Scoped port of mango-mobile's own src/wallet/walletRpc.js — cut down
// to exactly what's needed for a USDC balance read per chain (build plan
// deposit-currency decision): an EVM ERC-20 balanceOf and a Solana SPL
// token balance. Not ported: mobile's native-balance reads, custom-token
// metadata discovery, and the same-chain multicall batching (that
// optimization pays off when several DIFFERENT tokens on the SAME chain
// are read together — this app only ever reads one token, USDC, per
// chain, so batching would have nothing to batch).
//
// A 45s balance cache mirrors mobile's own — a USDC balance doesn't move
// minute-to-minute for most users, and re-fetching on every render would
// just be redundant RPC load for the same answer.

import {createPublicClient} from 'viem';
import {getViemChain, transportFor} from '../core/chainRegistry.ts';
import type {ChainKey} from '../core/chainData';

const SOLANA_RPC_ENDPOINTS = ['https://rpc.solanatracker.io/public', 'https://api.mainnet-beta.solana.com'];

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{name: 'account', type: 'address'}],
    outputs: [{type: 'uint256'}],
    stateMutability: 'view',
  },
] as const;

const clientCache = new Map<ChainKey, ReturnType<typeof createPublicClient>>();

function getWalletPublicClient(chainKey: ChainKey) {
  const cached = clientCache.get(chainKey);
  if (cached) return cached;
  const chain = getViemChain(chainKey);
  const client = createPublicClient({chain, transport: transportFor(chain.id)});
  clientCache.set(chainKey, client);
  return client;
}

const BALANCE_CACHE_TTL_MS = 45_000;
const balanceCache = new Map<string, {data: number; fetchedAt: number}>();
function getCached(key: string): number | null {
  const entry = balanceCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt >= BALANCE_CACHE_TTL_MS) return null;
  return entry.data;
}
function setCached(key: string, data: number): void {
  balanceCache.set(key, {data, fetchedAt: Date.now()});
}

export async function fetchWalletTokenBalance(chainKey: ChainKey, tokenAddress: string, decimals: number, address: string, {forceFresh = false}: {forceFresh?: boolean} = {}): Promise<number> {
  const key = `evm-token:${chainKey}:${tokenAddress.toLowerCase()}:${address.toLowerCase()}`;
  if (!forceFresh) {
    const cached = getCached(key);
    if (cached !== null) return cached;
  }
  const client = getWalletPublicClient(chainKey);
  const raw = await client.readContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  });
  const balance = Number(raw) / 10 ** decimals;
  setCached(key, balance);
  return balance;
}

/**
 * Zero is a real, common answer — a wallet that's never held this token
 * has no associated token account (ATA) at all, treated as balance 0,
 * not an error. Tries both the legacy TOKEN_PROGRAM_ID and
 * TOKEN_2022_PROGRAM_ID (same real bug fix mobile's own walletRpc.js
 * documents: a Token-2022 mint's ATA lives at a different derived
 * address entirely, so guessing only the legacy program silently reads
 * "no account" forever for those tokens instead of the real balance).
 */
export async function fetchWalletSplTokenBalance(mintAddress: string, decimals: number, ownerAddress: string, {forceFresh = false}: {forceFresh?: boolean} = {}): Promise<number> {
  const key = `solana-token:${mintAddress}:${ownerAddress}`;
  if (!forceFresh) {
    const cached = getCached(key);
    if (cached !== null) return cached;
  }
  let lastError: unknown;
  for (const url of SOLANA_RPC_ENDPOINTS) {
    try {
      const [{Connection, PublicKey}, {getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID}] = await Promise.all([import('@solana/web3.js'), import('@solana/spl-token')]);
      const connection = new Connection(url, 'confirmed');
      const mintPubkey = new PublicKey(mintAddress);
      const ownerPubkey = new PublicKey(ownerAddress);
      let balance: number | null = null;
      for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        try {
          const ata = await getAssociatedTokenAddress(mintPubkey, ownerPubkey, false, programId);
          const account = await getAccount(connection, ata, 'confirmed', programId);
          balance = Number(account.amount) / 10 ** decimals;
          break;
        } catch {
          // No ATA under this program — try the other one before
          // concluding the balance is genuinely zero.
        }
      }
      if (balance === null) balance = 0;
      setCached(key, balance);
      return balance;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Could not reach any Solana RPC endpoint.');
}
