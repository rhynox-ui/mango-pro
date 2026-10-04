// src/settings/gaslessTradingPrefs.ts
//
// Default-on preference for the EIP-7702 gasless trading path
// (Relay primary, Pimlico secondary) (smartAccount.ts, executeRelayQuote.ts's sendRelayEvmStepSponsored).
// This app's whole premise is not needing native gas to trade — a new
// user shouldn't be able to fund the wallet and then discover trading
// is blocked because they hold no ETH/BNB/etc. on top of it. App.tsx's
// finishOnboarding sets this explicitly right after a seed wallet is
// created/imported (and shows GaslessTradingIntroModal once, so this
// isn't silent), but the default here is ALSO true — matching that
// intent for any read that happens before onboarding gets a chance to
// set it (or a future call site that doesn't). Still overridable from
// Security settings (a Relay/Pimlico gasless path that cannot sponsor still
// falls back to a plain transaction either way — see
// executeRelayQuote.ts — so turning this off never removes the ability
// to trade, only which path is tried first) and still meaningless for a
// Google/Particle session, which has no local key to sign a 7702
// delegation with. Same AsyncStorage-backed shape autoLockPrefs.ts
// already establishes.

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
