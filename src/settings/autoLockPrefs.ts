// src/settings/autoLockPrefs.ts
//
// Auto-lock duration preference — exact scoped port of mango-mobile's
// own src/settings/autoLockPrefs.js, itself written to fix a real gap
// that app had: an AppState-driven lock-on-background timer existed,
// but with a hardcoded threshold and no Settings entry at all, so a
// user could never see it exists, shorten it, or lengthen it. Mango
// Pro's own App.tsx had no auto-lock mechanism whatsoever before this —
// once unlocked, the session key sat in memory indefinitely — so this
// lands both the preference and (in App.tsx's AuthGate) the real
// enforcement together, not the preference alone.
//
// Same mobile-appropriate preset range as the source file, for the same
// reason: a phone wallet holding real private keys shouldn't offer
// "never" the way a browser-extension wallet reasonably can.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'mango_pro_auto_lock_ms_v1';
// 5 minutes, not 1 — a Google-login session's "lock" is a full sign-out
// (logoutParticle() + back to the Welcome screen, not a quick password
// re-entry; see App.tsx's own handleLock comment on why), so a 60-second
// default punished perfectly ordinary brief backgrounding (checking
// another app, switching to a terminal to read device logs) with a full
// re-login. Still user-configurable in Security, presets unchanged.
export const DEFAULT_AUTO_LOCK_MS = 5 * 60_000;

export const AUTO_LOCK_OPTIONS: {label: string; ms: number}[] = [
  {label: 'Immediately', ms: 0},
  {label: '30 seconds', ms: 30_000},
  {label: '1 minute', ms: 60_000},
  {label: '5 minutes', ms: 5 * 60_000},
  {label: '15 minutes', ms: 15 * 60_000},
];

export async function loadAutoLockMs(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_AUTO_LOCK_MS;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_AUTO_LOCK_MS;
  } catch {
    return DEFAULT_AUTO_LOCK_MS;
  }
}

export async function setAutoLockMs(ms: number): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, String(ms));
}
