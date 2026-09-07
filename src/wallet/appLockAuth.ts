// src/wallet/appLockAuth.ts
//
// Biometric APP-ACCESS gate for Google/Particle login sessions — a real
// gap biometricAuth.ts's own vault-password gate can't cover: a Google
// session has no local password or vault at all (Particle's MPC network
// holds the key, never this device), so there is nothing for that
// module's BIOMETRY_ANY_OR_DEVICE_PASSCODE-gated storage to protect.
//
// Same react-native-keychain mechanism, different purpose: this stores
// a fixed marker string (never a real secret) behind the device's own
// biometric/passcode check, purely so `verifyAppLock()` succeeding or
// failing IS the answer to "did this person pass the device's own lock
// screen check right now" — nothing about the stored value itself
// matters. The real Particle session (an address, not a private key —
// see particleAuth.ts's own header) stays live across this gate; there
// is no re-authentication network round trip on unlock, since nothing
// sensitive was ever cleared. App.tsx's handleLock decides when to
// route here instead of the full sign-out it uses when app-lock is off.

import * as Keychain from 'react-native-keychain';

const SERVICE = 'mango-pro-app-lock';
const USERNAME = 'mango-pro-app-lock';
const MARKER = 'unlocked';

export async function isAppLockEnabled(): Promise<boolean> {
  try {
    return Boolean(await Keychain.hasGenericPassword({service: SERVICE}));
  } catch {
    return false;
  }
}

/**
 * Enabling IS the confirmation — unlike biometricAuth.ts's
 * enableBiometricUnlock (which needs a caller to have already verified
 * a real password first), there is no password here to check, so
 * setGenericPassword's own OS prompt is the only gate this needs.
 * Returns false if that prompt is cancelled or fails.
 */
export async function enableAppLock(): Promise<boolean> {
  try {
    const result = await Keychain.setGenericPassword(USERNAME, MARKER, {
      service: SERVICE,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return result !== false;
  } catch {
    return false;
  }
}

export async function disableAppLock(): Promise<boolean> {
  try {
    return await Keychain.resetGenericPassword({service: SERVICE});
  } catch {
    return false;
  }
}

/** Prompts biometric/passcode auth; true only if it actually succeeded. */
export async function verifyAppLock(): Promise<boolean> {
  try {
    const result = await Keychain.getGenericPassword({
      service: SERVICE,
      authenticationPrompt: {
        title: 'Unlock Mango Pro',
        subtitle: 'Use your biometrics to continue',
        cancel: 'Log out instead',
      },
    });
    return Boolean(result);
  } catch {
    return false;
  }
}
