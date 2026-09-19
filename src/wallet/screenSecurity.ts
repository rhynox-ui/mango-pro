// src/wallet/screenSecurity.ts
//
// Ported from mango-mobile's own screenSecurity.js — thin wrapper over
// ScreenSecurityModule.kt, which toggles Android's FLAG_SECURE on the
// current window (blocks screenshots, screen recording, and the
// recent-apps thumbnail).
//
// FAILS CLOSED at the call site that reveals a secret (RevealPhraseModal.tsx):
// this reports whether the flag was actually applied, and that modal
// refuses to display the phrase when it wasn't. Turning the flag OFF is
// still best-effort — failing to un-secure a window is harmless.
//
// The native side resolves its promise with `false` (not a rejection)
// when there's no current activity to apply the flag to — a real,
// reachable case, not just theoretical. That resolved value is
// returned as-is here, not discarded — mango-mobile's own equivalent
// used to `await` the call and then return `true` unconditionally,
// silently turning a genuine "not applied" outcome into a false
// "success" and defeating this exact fail-closed contract; fixed there
// too, but written correctly here from the start.
//
// Only meaningful on Android, which is the only platform this app
// builds for (there is no ios/ directory). If that changes, iOS has no
// FLAG_SECURE equivalent and will need its own mechanism plus its own
// decision here — do not let it silently report success.

import {NativeModules} from 'react-native';

/**
 * Applies or clears FLAG_SECURE.
 *
 * Returns true only when the flag was genuinely applied. Callers that
 * are about to render a secret MUST check this and refuse to render on
 * false — that is the whole point of the return value.
 */
export async function setScreenSecure(secure: boolean): Promise<boolean> {
  try {
    const module = NativeModules.ScreenSecurityModule;
    if (!module?.setSecure) {
      return false;
    }
    return await module.setSecure(secure);
  } catch {
    return false;
  }
}
