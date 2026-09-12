// src/wallet/vault.ts
//
// Storage half of the wallet vault — adapted from mango-mobile's own
// src/wallet/vault.js, deliberately simplified: mobile's schema holds an
// array of wallets (each with its own account count/labels) plus
// standalone imported keys, because mobile has real multi-account UI.
// Mango Pro doesn't yet — one wallet, account index 0 — so the schema
// here is just the single encrypted mnemonic record. Widening this to
// mobile's fuller shape is a mechanical follow-up once multi-account
// support is an actual feature, not a reason to build it now.
//
// encryptSecret/decryptSecret call straight into walletCipher.ts's
// pure-JS PBKDF2 path — mobile also tries a native-accelerated PBKDF2
// module first; that hasn't been ported here yet (see walletCipher.ts's
// own header), so unlock is correct but not yet as fast as it could be.
//
// Storage uses @react-native-async-storage/async-storage — on-device
// only, nothing ever transmitted. Own storage key (not mobile's), so the
// two apps' vaults never collide even if both are ever installed on the
// same device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {decryptSecret as cipherDecrypt, encryptSecret as cipherEncrypt, type SecretRecord} from './walletCipher.ts';
import {getLockoutStatus, recordFailedAttempt, recordSuccessfulUnlock} from './unlockAttempts';

export {decryptSecret, encryptSecret} from './walletCipher.ts';

/** Thrown by unlockVaultMnemonic when the attempt lockout (unlockAttempts.ts) is active. Carries remainingMs so a UI can show a countdown without a second getLockoutStatus() read. */
export class VaultLockedError extends Error {
  remainingMs: number;
  constructor(remainingMs: number) {
    super(`Too many incorrect attempts. Try again in ${Math.ceil(remainingMs / 1000)}s.`);
    this.name = 'VaultLockedError';
    this.remainingMs = remainingMs;
  }
}
export type {SecretRecord};

const STORAGE_KEY = 'mango_pro_wallet_vault_v1';
const VAULT_SCHEMA_VERSION = 1;

type StoredVault = {
  version: number;
  mnemonicRecord: SecretRecord;
};

export async function saveVault(mnemonicRecord: SecretRecord): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({version: VAULT_SCHEMA_VERSION, mnemonicRecord}));
}

export async function loadVault(): Promise<StoredVault | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== VAULT_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function hasVault(): Promise<boolean> {
  return (await loadVault()) !== null;
}

/** Permanently deletes the local encrypted vault. Callers MUST have already made the user confirm they've backed up their recovery phrase — this cannot be undone. */
export async function clearVault(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/**
 * Decrypts the stored vault's mnemonic with a password. Throws
 * "Incorrect password." on a wrong password or corrupt record, or
 * VaultLockedError while the attempt lockout is active.
 *
 * Lockout enforcement lives HERE, not in each caller's own UI code — a
 * security audit flagged that it used to live only in LockedScreen.tsx,
 * so any other call site (EnableBiometricModal.tsx calls this directly
 * to verify a password before enrolling biometrics) got unlimited,
 * unthrottled guesses. Centralizing it in the one real decrypt primitive
 * means every future caller inherits the same throttle by construction,
 * rather than needing to remember to wire unlockAttempts.ts itself.
 */
export async function unlockVaultMnemonic(vault: StoredVault, password: string): Promise<string> {
  const status = await getLockoutStatus();
  if (status.locked) {
    throw new VaultLockedError(status.remainingMs);
  }
  try {
    const mnemonic = await cipherDecrypt(vault.mnemonicRecord, password);
    await recordSuccessfulUnlock();
    return mnemonic;
  } catch (err) {
    if (err instanceof VaultLockedError) throw err;
    await recordFailedAttempt();
    throw err;
  }
}

/** Encrypts a fresh mnemonic under a password and persists it as the vault. */
export async function createVault(mnemonic: string, password: string): Promise<void> {
  const mnemonicRecord = await cipherEncrypt(mnemonic, password);
  await saveVault(mnemonicRecord);
}
