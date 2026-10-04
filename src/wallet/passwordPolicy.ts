// src/wallet/passwordPolicy.ts
//
// Ported (typed) from mango-mobile's own src/wallet/passwordPolicy.js —
// same rule, same reasoning: the vault is PBKDF2-HMAC-SHA256 at 600,000
// iterations with AES-256-GCM, which makes offline guessing expensive
// per candidate — but that only matters when there are many candidates.
// Fourteen characters is the minimum for newly-created vault passwords. PBKDF2
// is intentionally expensive, but password length and unpredictability still
// dominate offline resistance.
//
// Applies only to SETTING a password, never to unlocking — this file
// has no involvement in the unlock path at all.

export const MIN_PASSWORD_LENGTH = 14;

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

export type PasswordPolicyResult = {
  longEnough: boolean;
  notCommon: boolean;
  notPredictable: boolean;
  ok: boolean;
};

/**
 * Evaluates a candidate password against the rules above. Returns each
 * rule separately so the UI can show which one is unmet.
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const value = typeof password === 'string' ? password : '';
  const normalized = value.trim().toLowerCase();
  const longEnough = value.length >= MIN_PASSWORD_LENGTH;
  const notCommon = !COMMON_PASSWORDS.has(normalized);

  // Length alone is not enough: reject obvious repeated characters,
  // ascending/descending digit runs, and keyboard-style walks. This is a
  // local policy only — it does not claim to be a breach database.
  const repeated = /^(.)\1+$/.test(normalized);
  const digitRun = /^(?:0123456789|1234567890|9876543210|0987654321)/.test(normalized);
  const keyboardWalk = /^(?:qwerty|asdfgh|zxcvbn|qazwsx|wsxedc)/.test(normalized);
  const notPredictable = !repeated && !digitRun && !keyboardWalk;

  return {longEnough, notCommon, notPredictable, ok: longEnough && notCommon && notPredictable};
}
