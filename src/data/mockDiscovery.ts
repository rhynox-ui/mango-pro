// src/data/mockDiscovery.ts
//
// Sample data for the Home discovery dashboard — traders, tokens, and
// filter categories. Explicitly mock, unlike the rest of this app's own
// "real shell, no fake numbers" discipline (SearchScreen, ProfileScreen):
// a discovery feed with nothing in it doesn't demonstrate the product at
// all, and the shape here is exactly what real data will fill once token
// search/trending (build plan §4) and a real leaderboard exist — swap
// these arrays for a live fetch, the screen that renders them doesn't
// change.

export type TraderCard = {
  id: string;
  username: string;
  avatarInitial: string;
  profitUsd: number;
};

export const MOCK_TRADERS: TraderCard[] = [
  {id: 't1', username: 'zeri_terminal', avatarInitial: 'Z', profitUsd: 1472832.19},
  {id: 't2', username: 'motiyawerey', avatarInitial: 'M', profitUsd: 1263766.98},
  {id: 't3', username: 'unipilot', avatarInitial: 'U', profitUsd: 941204.5},
  {id: 't4', username: 'basegoblin', avatarInitial: 'B', profitUsd: 618930.02},
];

export type DiscoveryToken = {
  id: string;
  symbol: string;
  avatarInitial: string;
  marketCapLabel: string;
  price: string;
  change24h: number;
  verified: boolean;
};

export const MOCK_TOKENS: DiscoveryToken[] = [
  {id: 'pons', symbol: 'PONS', avatarInitial: 'P', marketCapLabel: '$913.2M MC', price: '$0.913', change24h: 8.67, verified: true},
  {id: 'meme', symbol: 'MEME', avatarInitial: 'M', marketCapLabel: '$43.7M MC', price: '$0.0437', change24h: -6.01, verified: true},
  {id: 'ai', symbol: 'AI', avatarInitial: 'A', marketCapLabel: '$215.1M MC', price: '$0.217', change24h: 2.46, verified: true},
  {id: 'niulai', symbol: '牛来', avatarInitial: '牛', marketCapLabel: '$105.9M MC', price: '$0.106', change24h: -3.12, verified: true},
  {id: 'cashcat', symbol: 'CASHCAT', avatarInitial: 'C', marketCapLabel: '$228.8M MC', price: '$0.229', change24h: -7.58, verified: true},
  {id: 'ansem', symbol: 'ANSEM', avatarInitial: 'A', marketCapLabel: '$265.9M MC', price: '$0.267', change24h: 10.42, verified: true},
  {id: 'boner', symbol: 'BONER', avatarInitial: 'B', marketCapLabel: '$30.9M MC', price: '$0.0310', change24h: -0.41, verified: true},
  {id: 'cate', symbol: 'CATE', avatarInitial: 'C', marketCapLabel: '$34.2M MC', price: '$0.0342', change24h: 5.2, verified: true},
];

export const TOKEN_FILTERS = ['Trending', 'Most held', 'Graduated', 'Bonding'] as const;
export type TokenFilter = (typeof TOKEN_FILTERS)[number];
