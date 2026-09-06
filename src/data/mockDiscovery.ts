// src/data/mockDiscovery.ts
//
// Sample data for the Home discovery dashboard's token list. Explicitly
// mock, unlike the rest of this app's own "real shell, no fake numbers"
// discipline (SearchScreen, ProfileScreen): an empty discovery feed
// wouldn't demonstrate the product at all. Swap this array for a live
// DexScreener trending fetch once build plan §4 lands — the screen that
// renders it doesn't change.
//
// No trader leaderboard and no "verified" badge here — per an explicit
// product decision, both are deferred until the app has real revenue/
// trade history to base them on (a leaderboard needs real PnL to
// compute, and a flat "verified" checkmark misrepresents permissionless
// tokens; a real safety badge belongs on GoPlus security data instead).

export type DiscoveryToken = {
  id: string;
  symbol: string;
  avatarInitial: string;
  marketCapLabel: string;
  price: string;
  change24h: number;
};

export const MOCK_TOKENS: DiscoveryToken[] = [
  {id: 'pons', symbol: 'PONS', avatarInitial: 'P', marketCapLabel: '$913.2M MC', price: '$0.913', change24h: 8.67},
  {id: 'meme', symbol: 'MEME', avatarInitial: 'M', marketCapLabel: '$43.7M MC', price: '$0.0437', change24h: -6.01},
  {id: 'ai', symbol: 'AI', avatarInitial: 'A', marketCapLabel: '$215.1M MC', price: '$0.217', change24h: 2.46},
  {id: 'niulai', symbol: '牛来', avatarInitial: '牛', marketCapLabel: '$105.9M MC', price: '$0.106', change24h: -3.12},
  {id: 'cashcat', symbol: 'CASHCAT', avatarInitial: 'C', marketCapLabel: '$228.8M MC', price: '$0.229', change24h: -7.58},
  {id: 'ansem', symbol: 'ANSEM', avatarInitial: 'A', marketCapLabel: '$265.9M MC', price: '$0.267', change24h: 10.42},
  {id: 'boner', symbol: 'BONER', avatarInitial: 'B', marketCapLabel: '$30.9M MC', price: '$0.0310', change24h: -0.41},
  {id: 'cate', symbol: 'CATE', avatarInitial: 'C', marketCapLabel: '$34.2M MC', price: '$0.0342', change24h: 5.2},
];

export const TOKEN_FILTERS = ['Trending', 'Most held', 'Graduated', 'Bonding'] as const;
export type TokenFilter = (typeof TOKEN_FILTERS)[number];
