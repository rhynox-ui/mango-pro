// src/settings/gaslessTradingPrefs.ts
//
// Opt-in preference for the EIP-7702/Pimlico sponsored-gas trading path
// (smartAccount.ts, executeRelayQuote.ts's sendRelayEvmStepSponsored) —
// ARCHITECTURE.md §1's "ships as an opt-in toggle, not forced onto
// existing users" decision. Off by default: a user who never visits
// Security keeps trading exactly as before, holding native gas on
// whichever chain they spend from. Same AsyncStorage-backed shape
// autoLockPrefs.ts already establishes.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'mango_pro_gasless_trading_enabled_v1';

export async function loadGaslessTradingEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setGaslessTradingEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
}
