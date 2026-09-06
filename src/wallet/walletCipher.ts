// src/wallet/walletCipher.ts
//
// Ported (typed) from mango-mobile's own src/wallet/walletCipher.js —
// the pure-crypto half of vault.ts: encryptSecret/decryptSecret, zero
// dependency on AsyncStorage or anything else RN-specific. One real
// difference from mobile's version: mobile also tries a native-
// accelerated PBKDF2 path (a custom Kotlin module) before falling back
// to the pure-JS one here — that native module isn't ported yet, so
// vault.ts calls derivePureJsAesKeyBytes directly. Same algorithm either
// way (PBKDF2-HMAC-SHA256, 600k iterations, AES-256-GCM); a native
// speedup is a real, worthwhile follow-up, not a correctness gap.

import {pbkdf2Async} from '@noble/hashes/pbkdf2.js';
import {sha256} from '@noble/hashes/sha2.js';
import {gcm} from '@noble/ciphers/aes.js';

export const PBKDF2_ITERATIONS = 600_000;

export type SecretRecord = {
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// The synchronous `pbkdf2` blocks the calling thread for the entire
// 600k-iteration computation with no chance to yield — on Hermes (no
// JIT) that's easily several seconds of a fully frozen JS thread: no
// re-render (so a "loading" spinner set right before this call never
// actually paints), no touch/gesture handling, and long enough to risk
// Android's ANR watchdog. `pbkdf2Async` computes the identical derived
// key (same algorithm/params, just yielding back to the event loop
// periodically) — same security, but the app stays responsive.
export function derivePureJsAesKeyBytes(password: string, saltBytes: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, new TextEncoder().encode(password), saltBytes, {c: iterations, dkLen: 32});
}

/** AES-256-GCM encrypt/decrypt around an already-derived key. */
export function encryptWithKeyBytes(secret: string, keyBytes: Uint8Array, ivBytes: Uint8Array): Uint8Array {
  return gcm(keyBytes, ivBytes).encrypt(new TextEncoder().encode(secret));
}

/** Throws (via GCM's auth tag) if the password/key is wrong or the record is corrupt. */
export function decryptWithKeyBytes(ciphertextBytes: Uint8Array, keyBytes: Uint8Array, ivBytes: Uint8Array): string {
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(keyBytes, ivBytes).decrypt(ciphertextBytes);
  } catch {
    throw new Error('Incorrect password.');
  }
  return new TextDecoder().decode(plaintext);
}

// Bounds for a stored record's own PBKDF2 iteration count.
//
// The upper bound is the one that matters most, and it is not about
// cryptography: `record.iterations` is read straight out of persisted
// storage and fed to a key-derivation loop. A corrupted or tampered
// vault claiming an absurd iteration count would hang the app forever on
// unlock with no error and no way out — a denial of service against the
// user's own funds. Capping it turns that into a clean rejection.
//
// The lower bound guards the downgrade direction: a record rewritten to
// claim a tiny iteration count is not something an attacker can decrypt
// without the password anyway, but accepting it would let a vault
// silently lose its work factor. Set well below the 600,000 this app
// always writes so no real vault is ever locked out by it.
const MIN_ACCEPTED_ITERATIONS = 50_000;
const MAX_ACCEPTED_ITERATIONS = 5_000_000;

const EXPECTED_SALT_BYTES = 16;
const EXPECTED_IV_BYTES = 12;
// AES-GCM appends a 16-byte auth tag, so any real ciphertext is at least
// that long even when the plaintext was empty.
const MIN_CIPHERTEXT_BYTES = 16;

function decodedLength(value: unknown, field: string): number {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Vault record is malformed: ${field} is missing.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(value);
  } catch {
    throw new Error(`Vault record is malformed: ${field} is not valid base64.`);
  }
  return bytes.length;
}

/**
 * Rejects a malformed or hostile stored record BEFORE any key derivation
 * runs — everything here is read from persisted storage, so none of it
 * can be assumed well-formed. Throws on anything invalid.
 */
export function assertValidSecretRecord(record: unknown): asserts record is SecretRecord {
  if (!record || typeof record !== 'object') {
    throw new Error('Vault record is malformed: not an object.');
  }
  const {iterations} = record as SecretRecord;
  if (!Number.isInteger(iterations)) {
    throw new Error('Vault record is malformed: iterations is not an integer.');
  }
  if (iterations < MIN_ACCEPTED_ITERATIONS || iterations > MAX_ACCEPTED_ITERATIONS) {
    throw new Error(`Vault record is malformed: iterations ${iterations} is outside the accepted range.`);
  }
  const saltBytes = decodedLength((record as SecretRecord).salt, 'salt');
  if (saltBytes !== EXPECTED_SALT_BYTES) {
    throw new Error(`Vault record is malformed: salt is ${saltBytes} bytes, expected ${EXPECTED_SALT_BYTES}.`);
  }
  const ivBytes = decodedLength((record as SecretRecord).iv, 'iv');
  if (ivBytes !== EXPECTED_IV_BYTES) {
    throw new Error(`Vault record is malformed: iv is ${ivBytes} bytes, expected ${EXPECTED_IV_BYTES}.`);
  }
  const ctBytes = decodedLength((record as SecretRecord).ciphertext, 'ciphertext');
  if (ctBytes < MIN_CIPHERTEXT_BYTES) {
    throw new Error(`Vault record is malformed: ciphertext is ${ctBytes} bytes, too short to contain a GCM tag.`);
  }
}

/** Encrypts any secret string (mnemonic, or an imported private key) under a password. Returns the record to persist — does not write to storage itself. */
export async function encryptSecret(secret: string, password: string): Promise<SecretRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyBytes = await derivePureJsAesKeyBytes(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = encryptWithKeyBytes(secret, keyBytes, iv);
  return {
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

/** Decrypts a stored record with a password. Throws (via GCM's auth tag) if the password is wrong or the record is corrupt. */
export async function decryptSecret(record: SecretRecord, password: string): Promise<string> {
  assertValidSecretRecord(record);
  const keyBytes = await derivePureJsAesKeyBytes(password, fromBase64(record.salt), record.iterations);
  return decryptWithKeyBytes(fromBase64(record.ciphertext), keyBytes, fromBase64(record.iv));
}
