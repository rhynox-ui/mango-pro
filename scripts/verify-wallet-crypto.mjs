// scripts/verify-wallet-crypto.mjs
//
// Offline correctness checks for src/wallet/{keys,vault,walletCipher,
// slip10Ed25519}.ts — no device, no emulator. Node already provides
// everything this code needs natively (crypto.getRandomValues,
// TextEncoder/Decoder, Buffer) — react-native-get-random-values and
// src/polyfills.ts exist only because Hermes doesn't, so this script
// exercises the exact same algorithm the app ships, unpolyfilled.
//
// Same two things mango-mobile's own verify-wallet-crypto.mjs checks:
//  1. A recovery phrase derives the standard, independently-known
//     BIP-44 EVM address and the SLIP-10 ed25519 derivation matches the
//     real `ed25519-hd-key` package byte-for-byte (the same independent
//     reference mobile's own script cross-checks against).
//  2. The vault's PBKDF2/AES-GCM round-trips correctly and a wrong
//     password fails loudly (GCM auth tag), never silently returns
//     garbage.
//
// Run: node --experimental-strip-types scripts/verify-wallet-crypto.mjs

import assert from 'node:assert/strict';
import {derivePath as realDerivePath, getMasterKeyFromSeed as realGetMaster} from 'ed25519-hd-key';
import * as bip39 from 'bip39';
import {generateMnemonic, isValidMnemonic, deriveAccounts, normalizeMnemonic, suggestBip39Words} from '../src/wallet/keys.ts';
import {derivePath as myDerivePath, getMasterKeyFromSeed as myGetMaster} from '../src/wallet/slip10Ed25519.ts';
import {encryptSecret, decryptSecret, assertValidSecretRecord} from '../src/wallet/walletCipher.ts';

let n = 0;
function check(label, fn) {
  fn();
  n++;
  console.log(`ok ${n} - ${label}`);
}
async function checkAsync(label, fn) {
  await fn();
  n++;
  console.log(`ok ${n} - ${label}`);
}

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

check('generateMnemonic() produces a valid 12-word BIP-39 phrase', () => {
  const phrase = generateMnemonic();
  assert.equal(phrase.trim().split(/\s+/).length, 12);
  assert.equal(isValidMnemonic(phrase), true);
});

check('isValidMnemonic() rejects garbage', () => {
  assert.equal(isValidMnemonic('not a real recovery phrase at all here'), false);
});

check('normalizeMnemonic() trims/lowercases/collapses whitespace', () => {
  assert.equal(normalizeMnemonic('  Abandon  ABANDON   about '), 'abandon abandon about');
});

check('deriveAccounts() is deterministic — same mnemonic, same accounts', () => {
  const a = deriveAccounts(TEST_MNEMONIC);
  const b = deriveAccounts(TEST_MNEMONIC);
  assert.equal(a.evm.address, b.evm.address);
  assert.equal(a.evm.privateKey, b.evm.privateKey);
  assert.equal(a.solana.address, b.solana.address);
  assert.equal(a.solana.privateKey, b.solana.privateKey);
});

check("deriveAccounts() EVM address matches the well-known m/44'/60'/0'/0/0 address for the standard test mnemonic", () => {
  const {evm} = deriveAccounts(TEST_MNEMONIC);
  // Independently known address for this exact mnemonic at this exact
  // path — the same value every BIP-39 test-vector wallet (MetaMask,
  // ethers, viem's own docs) derives.
  assert.equal(evm.address.toLowerCase(), '0x9858effd232b4033e47d90003d41ec34ecaeda94');
});

check('deriveAccounts() rejects an invalid mnemonic rather than silently deriving garbage', () => {
  assert.throws(() => deriveAccounts('nope'), /Invalid recovery phrase/);
});

check('suggestBip39Words() only returns real wordlist entries with the given prefix', () => {
  const suggestions = suggestBip39Words('aband');
  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.every(w => w.startsWith('aband')));
  assert.ok(suggestions.includes('abandon'));
});

check("slip10Ed25519.ts's derivePath matches the real ed25519-hd-key package byte-for-byte", () => {
  const seed = bip39.mnemonicToSeedSync(TEST_MNEMONIC);
  const seedHex = Buffer.from(seed).toString('hex');
  const path = "m/44'/501'/0'/0'";

  // ed25519-hd-key returns plain Uint8Arrays, not Node Buffers — Uint8Array's
  // own toString() ignores an encoding argument entirely (it's inherited
  // from Array.prototype.toString, a comma-joined decimal dump), so both
  // sides need Buffer.from(...) to compare as hex correctly.
  const mine = myDerivePath(path, seedHex);
  const real = realDerivePath(path, seedHex);
  assert.equal(Buffer.from(mine.key).toString('hex'), Buffer.from(real.key).toString('hex'));
  assert.equal(Buffer.from(mine.chainCode).toString('hex'), Buffer.from(real.chainCode).toString('hex'));

  const myMaster = myGetMaster(seedHex);
  const realMaster = realGetMaster(seedHex);
  assert.equal(Buffer.from(myMaster.key).toString('hex'), Buffer.from(realMaster.key).toString('hex'));
});

await checkAsync('encryptSecret()/decryptSecret() round-trips the original secret', async () => {
  const record = await encryptSecret(TEST_MNEMONIC, 'correct horse battery staple 1');
  const decrypted = await decryptSecret(record, 'correct horse battery staple 1');
  assert.equal(decrypted, TEST_MNEMONIC);
});

await checkAsync('decryptSecret() throws "Incorrect password." on a wrong password rather than returning garbage', async () => {
  const record = await encryptSecret(TEST_MNEMONIC, 'correct horse battery staple 1');
  await assert.rejects(() => decryptSecret(record, 'wrong password entirely'), /Incorrect password/);
});

await checkAsync('assertValidSecretRecord() accepts a real record and rejects a tampered one', async () => {
  const record = await encryptSecret(TEST_MNEMONIC, 'correct horse battery staple 1');
  assertValidSecretRecord(record);
  assert.throws(() => assertValidSecretRecord({...record, iterations: 1}), /outside the accepted range/);
  // Buffer's base64 decoder is lenient (it skips invalid characters
  // rather than throwing), so a malformed salt is caught by the
  // resulting-length check below, not a decode failure — still a real
  // rejection, just via a different one of assertValidSecretRecord's checks.
  assert.throws(() => assertValidSecretRecord({...record, salt: 'not-base64!!'}), /salt is \d+ bytes, expected 16/);
  assert.throws(() => assertValidSecretRecord(null), /not an object/);
});

console.log(`\n${n}/${n} checks passed`);
