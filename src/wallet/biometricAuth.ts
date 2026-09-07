// src/wallet/biometricAuth.ts
//
// Typed port of mango-mobile's own src/wallet/biometricAuth.js — same
// library, same storage shape, same reasoning throughout (see that
// file's own header for the full history, including why "any secure
// lock screen" — not just enrolled biometric hardware — counts as
// available, and why BIOMETRY_ANY_OR_DEVICE_PASSCODE is the right access
// control for that).
//
// What's actually stored: the real wallet password, held in Android
// Keystore / iOS Keychain — the phone's own hardware-backed secure
// storage, gated so the OS only releases it after the device's own lock
// check succeeds. The password never leaves the device. Biometric
// unlock is only ever ENABLED after the user has already unlocked with
// their real password once in that session — this module never itself
// verifies a password, it only stores/retrieves one a caller has
// already confirmed is correct.

import * as Keychain from 'react-native-keychain';

const SERVICE = 'mango-pro-biometric-unlock';
const USERNAME = 'mango-pro-wallet';

const BIOMETRY_LABELS: Partial<Record<Keychain.BIOMETRY_TYPE, string>> = {
  [Keychain.BIOMETRY_TYPE.FINGERPRINT]: 'fingerprint',
  [Keychain.BIOMETRY_TYPE.FACE]: 'face',
  [Keychain.BIOMETRY_TYPE.IRIS]: 'iris',
  [Keychain.BIOMETRY_TYPE.FACE_ID]: 'Face ID',
  [Keychain.BIOMETRY_TYPE.TOUCH_ID]: 'Touch ID',
};

export async function getBiometryLabel(): Promise<string> {
  try {
    const biometryType = await Keychain.getSupportedBiometryType();
    return (biometryType && BIOMETRY_LABELS[biometryType]) ?? 'biometric';
  } catch {
    return 'biometric';
  }
}

/** True if the device has a real biometric sensor enrolled, or any secure lock screen (PIN/pattern/password) set up. */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const biometryType = await Keychain.getSupportedBiometryType();
    if (biometryType !== null) return true;
    return await Keychain.isPasscodeAuthAvailable();
  } catch {
    return false;
  }
}

export async function isBiometricUnlockEnabled(): Promise<boolean> {
  try {
    return Boolean(await Keychain.hasGenericPassword({service: SERVICE}));
  } catch {
    return false;
  }
}

/** Caller must have already verified `password` is correct — this never checks it. */
export async function enableBiometricUnlock(password: string): Promise<boolean> {
  const result = await Keychain.setGenericPassword(USERNAME, password, {
    service: SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return result !== false;
}

export async function disableBiometricUnlock(): Promise<boolean> {
  try {
    return await Keychain.resetGenericPassword({service: SERVICE});
  } catch {
    return false;
  }
}

/** Prompts for biometric auth and returns the stored password, or null if cancelled/failed. */
export async function getBiometricPassword(): Promise<string | null> {
  try {
    const result = await Keychain.getGenericPassword({
      service: SERVICE,
      authenticationPrompt: {
        title: 'Unlock Mango Pro',
        subtitle: 'Use your biometrics to unlock your wallet',
        cancel: 'Use password instead',
      },
    });
    if (!result) return null;
    return result.password;
  } catch {
    return null;
  }
}
