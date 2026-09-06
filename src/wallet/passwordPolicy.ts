// src/wallet/passwordPolicy.ts
//
// Ported (typed) from mango-mobile's own src/wallet/passwordPolicy.js —
// same rule, same reasoning: the vault is PBKDF2-HMAC-SHA256 at 600,000
// iterations with AES-256-GCM, which makes offline guessing expensive
// per candidate — but that only matters when there are many candidates.
// Twelve characters is the floor below which a real password stops
// making the work factor matter.
//
// Applies only to SETTING a password, never to unlocking — this file
// has no involvement in the unlock path at all.

export const MIN_PASSWORD_LENGTH = 12;

// A deliberately small, high-signal list rather than a pretend-complete
// one — the perennial top passwords, keyboard walks long enough to pass
// the length check, and the crypto-specific phrases people reach for
// when a wallet asks for one. Compared case-insensitively with
// surrounding whitespace ignored.
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789abc',
  'password1234',
  'passwordpassword',
  'qwertyuiop123',
  'qwertyuiopasd',
  '1qaz2wsx3edc',
  'adminadmin12',
  'letmeinletmein',
  'iloveyou1234',
  'welcome12345',
  'trustno1trustno1',
  'cryptowallet',
  'mywalletpass',
  'bitcoin12345',
  'ethereum1234',
  'seedphrase12',
  'walletpassword',
  'mangoprotocol',
]);

export type PasswordPolicyResult = {longEnough: boolean; notCommon: boolean; ok: boolean};

/**
 * Evaluates a candidate password against the rules above. Returns each
 * rule separately so the UI can show which one is unmet.
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const value = typeof password === 'string' ? password : '';
  const longEnough = value.length >= MIN_PASSWORD_LENGTH;
  const notCommon = !COMMON_PASSWORDS.has(value.trim().toLowerCase());
  return {longEnough, notCommon, ok: longEnough && notCommon};
}
