// src/core/geckoTerminalNetworks.ts
//
// Ported verbatim (values only, re-typed) from mango-mobile's own
// src/wallet/geckoTerminalNetworks.js — that file's own header explains
// why these IDs are hand-verified against GeckoTerminal's real /networks
// endpoint rather than guessed from a chain's name or EVM chain ID, and
// why an unmapped chain must resolve to null (a missing trending source
// is a garnish this app can live without) rather than throw or guess.
// Trimmed to the ChainKeys this app actually has — 'stable' has no
// verified GeckoTerminal network ID in mobile's own registry either, so
// it resolves to null here too, same as it would there.

import type {ChainKey} from './chainData';

const VERIFIED_NETWORK_IDS: Partial<Record<ChainKey, string>> = {
  ethereum: 'eth',
  base: 'base',
  bnb: 'bsc',
  robinhood: 'robinhood',
  solana: 'solana',
  arbitrum: 'arbitrum',
  avalanche: 'avax',
  abstract: 'abstract',
  hyperevm: 'hyperevm',
  ink: 'ink',
  plasma: 'plasma',
  unichain: 'unichain',
  xlayer: 'x-layer',
};

export function geckoTerminalNetworkForChainOrNull(chainKey: ChainKey): string | null {
  return VERIFIED_NETWORK_IDS[chainKey] ?? null;
}
