// src/settings/gaslessTradingPrefs.ts
//
// Default-on preference for Relay's gasless trading path.
// Relay is the only EVM gasless provider used by Mango Pro.
// This app's whole premise is not needing native gas to trade — a new
// user shouldn't be able to fund the wallet and then discover trading
// is blocked because they hold no ETH/BNB/etc. on top of it. App.tsx's
// finishOnboarding sets this explicitly right after a seed wallet is
// created/imported (and shows GaslessTradingIntroModal once, so this
// isn't silent), but the default here is ALSO true — matching that
// intent for any read that happens before onboarding gets a chance to
// set it (or a future call site that doesn't). Still overridable from
// Security settings (if Relay cannot execute gaslessly, execution falls back
// to a normal user-signed transaction — see
// executeRelayQuote.ts — native-gas fallback does not exist for trades.
 // The stored preference remains for settings/API compatibility.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'mango_pro_gasless_trading_enabled_v1';

export async function loadGaslessTradingEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export async function setGaslessTradingEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
}
