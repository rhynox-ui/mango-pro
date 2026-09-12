// src/wallet/portfolioHistory.ts
//
// Real, local-only portfolio-value-over-time history for ProfileScreen's
// chart. Mango Pro has no backend to reconstruct a full trade/price
// history from (see the build plan's own "free services before we're
// funded" steer) — rather than fabricate a past that never happened, or
// pay for on-chain log scanning + historical price APIs it can't afford
// yet, this starts recording real usdcPortfolio.totalUsd snapshots going
// FORWARD from whenever this feature first runs, and is honest about
// that in the UI (ProfileScreen's own empty-state copy) rather than
// pretending to show a longer history than actually exists.
//
// "Portfolio value" here means the same real cash figure ProfileScreen's
// own "Total cash" row already shows — real USDC held across every
// supported chain — not cash+open-token-positions. Reconstructing open
// positions' live mark-to-market value would need per-token price feeds
// this app doesn't otherwise fetch continuously; that's real, deferred
// engineering, not something to fake with a wrong number.
//
// Same AsyncStorage-backed, per-account-address-keyed pattern as
// profileLocal.ts (a second wallet on the same device never inherits the
// first one's history). No subscribe/notify plumbing like txHistory.ts's
// module-level store — only ProfileScreen reads this, and it already
// owns the one place a new snapshot gets recorded (its own
// usdcPortfolio-fetch effect), so a plain async read/write pair is
// enough.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'mango_pro_portfolio_history_v1:';
const MAX_SNAPSHOTS = 500;
// Skip recording a new point if the last one is more recent than this —
// ProfileScreen's fetch effect can re-run on every mount/focus, and
// recording every single one would make "24h" no more granular than
// "All". Five minutes is frequent enough to catch a real deposit/
// withdraw/trade's effect on the total without flooding storage.
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export type PortfolioSnapshot = {timestamp: number; totalUsd: number};

export type PortfolioRange = '24h' | '7d' | '30d' | 'All';

const RANGE_WINDOW_MS: Record<Exclude<PortfolioRange, 'All'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function keyFor(address: string): string {
  return `${KEY_PREFIX}${address.toLowerCase()}`;
}

export async function getPortfolioHistory(address: string): Promise<PortfolioSnapshot[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(address));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Appends a new snapshot (unless one was already recorded within
 * MIN_INTERVAL_MS) and returns the resulting full history, so the caller
 * can render immediately without a second read. Deliberately best-effort
 * like every other local-only store here — a failed write loses one
 * chart point, never the wallet.
 */
export async function recordPortfolioSnapshot(address: string, totalUsd: number): Promise<PortfolioSnapshot[]> {
  const history = await getPortfolioHistory(address);
  const last = history[history.length - 1];
  const now = Date.now();
  if (last && now - last.timestamp < MIN_INTERVAL_MS) {
    return history;
  }
  const next = [...history, {timestamp: now, totalUsd}].slice(-MAX_SNAPSHOTS);
  try {
    await AsyncStorage.setItem(keyFor(address), JSON.stringify(next));
  } catch {
    // Best-effort — same reasoning as every other local-only store.
  }
  return next;
}

/** Snapshots within the selected range, oldest first (input is already oldest-first). */
export function filterHistoryByRange(history: PortfolioSnapshot[], range: PortfolioRange): PortfolioSnapshot[] {
  if (range === 'All') return history;
  const cutoff = Date.now() - RANGE_WINDOW_MS[range];
  return history.filter(s => s.timestamp >= cutoff);
}

export type PortfolioChange = {absolute: number; percent: number; isPositive: boolean};

/** Change from the first to the last point in an already-range-filtered list, or null if there isn't enough real data to compare. */
export function computePortfolioChange(points: PortfolioSnapshot[]): PortfolioChange | null {
  if (points.length < 2) return null;
  const first = points[0].totalUsd;
  const last = points[points.length - 1].totalUsd;
  const absolute = last - first;
  const percent = first !== 0 ? (absolute / first) * 100 : 0;
  return {absolute, percent, isPositive: absolute >= 0};
}
