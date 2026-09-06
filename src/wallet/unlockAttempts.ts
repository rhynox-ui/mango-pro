// src/wallet/unlockAttempts.ts
//
// Ported (typed) from mango-mobile's own src/wallet/unlockAttempts.js —
// rate-limits repeated wrong-password guesses on the lock screen. The
// vault itself stays protected regardless (600k-iteration PBKDF2 +
// AES-256-GCM — see walletCipher.ts — so an attacker without the device
// still has to brute-force offline no matter what this file does), but
// this closes the separate "device is physically unlocked, app is open"
// scenario, same as any banking app's own attempt-lockout.
//
// Persisted (not just in-memory component state) so force-quitting and
// reopening the app doesn't trivially reset the count.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'mango_pro_unlock_attempts_v1';

// First 5 wrong attempts get no lockout at all — real typos shouldn't
// trigger this. After that, escalating cooldowns (30s, 1m, 2m, 5m,
// capped at 15m) — same shape most banking apps use.
const FREE_ATTEMPTS = 5;
const LOCKOUT_DURATIONS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000];

type AttemptState = {failCount: number; lockedUntil: number};
export type LockoutStatus = {locked: boolean; remainingMs: number};

async function load(): Promise<AttemptState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {failCount: 0, lockedUntil: 0};
    const parsed = JSON.parse(raw);
    return {
      failCount: Number.isFinite(parsed.failCount) ? parsed.failCount : 0,
      lockedUntil: Number.isFinite(parsed.lockedUntil) ? parsed.lockedUntil : 0,
    };
  } catch {
    return {failCount: 0, lockedUntil: 0};
  }
}

async function save(state: AttemptState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort — a failed write just means the count doesn't persist
    // across a restart, never a hard error blocking unlock
  }
}

/** Call before letting the user submit a password. */
export async function getLockoutStatus(): Promise<LockoutStatus> {
  const {lockedUntil} = await load();
  const remainingMs = lockedUntil - Date.now();
  return remainingMs > 0 ? {locked: true, remainingMs} : {locked: false, remainingMs: 0};
}

/** Call when unlock throws (wrong password). Returns the new lockout state so the caller can show it immediately without a second read. */
export async function recordFailedAttempt(): Promise<LockoutStatus> {
  const state = await load();
  const failCount = state.failCount + 1;
  let lockedUntil = state.lockedUntil;
  if (failCount > FREE_ATTEMPTS) {
    const tier = Math.min(failCount - FREE_ATTEMPTS - 1, LOCKOUT_DURATIONS_MS.length - 1);
    lockedUntil = Date.now() + LOCKOUT_DURATIONS_MS[tier];
  }
  await save({failCount, lockedUntil});
  const remainingMs = lockedUntil - Date.now();
  return remainingMs > 0 ? {locked: true, remainingMs} : {locked: false, remainingMs: 0};
}

/** Call once unlock actually succeeds — clears the count entirely. */
export async function recordSuccessfulUnlock(): Promise<void> {
  await save({failCount: 0, lockedUntil: 0});
}
