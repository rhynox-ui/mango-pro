// scripts/verify-solana-tx-intent.mjs
//
// Ported from mango-bridge.jsx's own scripts/verify-solana-tx-intent.mjs
// — same test vectors, run against this repo's own port of the module
// (src/core/solanaTxIntent.ts).
//
// Offline test vectors for src/core/solanaTxIntent.ts — the pre-sign
// check on the Solana path.
//
// Uses hand-built objects in both transaction shapes rather than the
// real SDK's builders, so this runs with no network, no wallet and no
// RPC: the module is deliberately structural (program ids and the first
// data byte) precisely so it can be tested this way.
//
// Run: node --experimental-strip-types scripts/verify-solana-tx-intent.mjs

import {SolanaIntentError, describeSolanaTransaction, assertSolanaTransactionMatchesIntent} from '../src/core/solanaTxIntent.ts';

const USER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const STRANGER = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed');
}
function blocks(fn, fragment) {
  let threw = null;
  try {
    fn();
  } catch (err) {
    threw = err;
  }
  assert(threw !== null, 'expected a block, but signing was allowed');
  assert(threw instanceof SolanaIntentError, `expected SolanaIntentError, got ${threw?.name}`);
  assert(threw.message.includes(fragment), `blocked for the wrong reason: ${threw.message}`);
}

// A VersionedTransaction as the wallet actually receives one: a
// compiled message with a static key table the instructions index into.
const versioned = (feePayer, instructions) => ({
  message: {
    staticAccountKeys: [{toBase58: () => feePayer}, {toBase58: () => TOKEN_PROGRAM}, {toBase58: () => TOKEN_2022}, {toBase58: () => SYSTEM_PROGRAM}],
    compiledInstructions: instructions.map(({programIndex, dataByte}) => ({
      programIdIndex: programIndex,
      data: dataByte === null ? new Uint8Array() : Uint8Array.from([dataByte]),
    })),
  },
});
// A sponsored VersionedTransaction: fee payer is index 0 as always, but
// numRequiredSignatures is 2 and the SECOND required signer is the real
// user — the shape signAndSendSponsoredSolanaStep actually produces.
const sponsored = (feePayer, userKey, instructions) => ({
  message: {
    header: {numRequiredSignatures: 2},
    staticAccountKeys: [{toBase58: () => feePayer}, {toBase58: () => userKey}, {toBase58: () => TOKEN_PROGRAM}, {toBase58: () => TOKEN_2022}, {toBase58: () => SYSTEM_PROGRAM}],
    compiledInstructions: instructions.map(({programIndex, dataByte}) => ({
      programIdIndex: programIndex,
      data: dataByte === null ? new Uint8Array() : Uint8Array.from([dataByte]),
    })),
  },
});
// A legacy Transaction: instructions carry their own program ids.
const legacy = (feePayer, instructions) => ({
  feePayer: {toBase58: () => feePayer},
  instructions: instructions.map(({programId, dataByte}) => ({
    programId: {toBase58: () => programId},
    data: dataByte === null ? new Uint8Array() : Uint8Array.from([dataByte]),
  })),
});

// ---- both shapes are understood -----------------------------------
check('a versioned transaction is parsed', () => {
  const d = describeSolanaTransaction(versioned(USER, [{programIndex: 3, dataByte: 2}]));
  assert(d.feePayer === USER, d.feePayer);
  assert(d.instructions[0].programId === SYSTEM_PROGRAM, d.instructions[0].programId);
});
check('a legacy transaction is parsed', () => {
  const d = describeSolanaTransaction(legacy(USER, [{programId: SYSTEM_PROGRAM, dataByte: 2}]));
  assert(d.feePayer === USER, d.feePayer);
});
check('an unrecognised shape parses to null rather than throwing', () => {
  assert(describeSolanaTransaction({nonsense: true}) === null);
  assert(describeSolanaTransaction(null) === null);
});

// ---- the block ------------------------------------------------------
check('BLOCKS a transaction paid for by somebody else', () => {
  blocks(() => assertSolanaTransactionMatchesIntent(versioned(STRANGER, []), {expectedSigner: USER}), 'not by your wallet');
});
check('BLOCKS it in the legacy shape too', () => {
  blocks(() => assertSolanaTransactionMatchesIntent(legacy(STRANGER, []), {expectedSigner: USER}), 'not by your wallet');
});
check('base58 comparison is case-sensitive (unlike an EVM address)', () => {
  // Same characters, different case — a DIFFERENT Solana account.
  blocks(() => assertSolanaTransactionMatchesIntent(versioned(USER.toLowerCase(), []), {expectedSigner: USER}), 'not by your wallet');
});

// ---- the honest path is not blocked --------------------------------
check('an ordinary route signed by the user passes with no warnings', () => {
  const warnings = assertSolanaTransactionMatchesIntent(
    versioned(USER, [
      {programIndex: 3, dataByte: 2}, // SystemProgram transfer
      {programIndex: 1, dataByte: 12}, // spl-token TransferChecked
    ]),
    {expectedSigner: USER},
  );
  assert(warnings.length === 0, JSON.stringify(warnings));
});
check('an empty-data instruction does not crash the parser', () => {
  assertSolanaTransactionMatchesIntent(versioned(USER, [{programIndex: 1, dataByte: null}]), {expectedSigner: USER});
});

// ---- the hard blocks --------------------------------------------------
// Promoted from warnings to hard blocks (real, confirmed finding from an
// uploaded audit's MANGO-H03, verified against solanaTxIntent.ts before
// acting — see that file's own updated comment). Regression coverage
// updated to match: these four instruction classes must now throw, not
// return a warning string nobody's UI necessarily surfaced.
check("BLOCKS an spl-token Approve (Solana's unlimited-allowance shape)", () => {
  blocks(() => assertSolanaTransactionMatchesIntent(versioned(USER, [{programIndex: 1, dataByte: 4}]), {expectedSigner: USER}), 'delegate');
});
check('BLOCKS ApproveChecked as well', () => {
  blocks(() => assertSolanaTransactionMatchesIntent(versioned(USER, [{programIndex: 1, dataByte: 13}]), {expectedSigner: USER}), 'delegate');
});
check('BLOCKS SetAuthority', () => {
  blocks(() => assertSolanaTransactionMatchesIntent(versioned(USER, [{programIndex: 1, dataByte: 6}]), {expectedSigner: USER}), 'authority');
});
check('BLOCKS CloseAccount', () => {
  blocks(() => assertSolanaTransactionMatchesIntent(versioned(USER, [{programIndex: 1, dataByte: 9}]), {expectedSigner: USER}), 'closes');
});
check('Token-2022 is checked, not just the classic token program', () => {
  blocks(() => assertSolanaTransactionMatchesIntent(versioned(USER, [{programIndex: 2, dataByte: 4}]), {expectedSigner: USER}), 'delegate');
});
check('the same byte under a NON-token program is not flagged', () => {
  // Byte 4 means something entirely different to the system program;
  // matching on data bytes alone, without the program id, would block
  // every ordinary route.
  const warnings = assertSolanaTransactionMatchesIntent(versioned(USER, [{programIndex: 3, dataByte: 4}]), {expectedSigner: USER});
  assert(warnings.length === 0, JSON.stringify(warnings));
});
check('an unparseable transaction is now a hard block, not a warning', () => {
  // Promoted from warning to hard block (MANGO-H02, same verification
  // discipline as above): an inability to inspect a transaction is not
  // evidence it's safe. See solanaTxIntent.ts's own updated comment for
  // why this is low-risk to legitimate trades — every shape this app
  // itself ever builds is one of the two describeSolanaTransaction
  // already recognizes.
  blocks(() => assertSolanaTransactionMatchesIntent({nonsense: true}, {expectedSigner: USER}), 'could not be inspected');
});

// ---- sponsored transactions: fee payer != user, by design ----------
// Regression coverage for a real, confirmed bug: signAndSendSponsoredSolanaStep
// builds the transaction with Mango's OWN sponsor as fee payer, then used
// to call this exact function with only {expectedSigner: <the user>} —
// which always threw, because the fee payer (the sponsor) never equals
// the user. Every sponsored trade failed closed, and the failure got
// swallowed into a misleading "add more SOL" message one layer up.
const SPONSOR = '7c9x2h9F1EPBaK2mgd5uhTZDDA1LX2CU1M9V4EbxVj44';
check('a sponsored transaction (fee payer = sponsor, user still a required signer) is allowed', () => {
  const warnings = assertSolanaTransactionMatchesIntent(sponsored(SPONSOR, USER, [{programIndex: 4, dataByte: 2}]), {
    expectedSigner: USER,
    expectedFeePayer: SPONSOR,
  });
  assert(warnings.length === 0, JSON.stringify(warnings));
});
check('BLOCKS a sponsored transaction if the user is NOT actually a required signer', () => {
  // Same fee payer as an honest sponsorship, but the user's key never
  // appears — the sponsor covering the fee must never be mistaken for
  // the user having authorized anything.
  blocks(
    () => assertSolanaTransactionMatchesIntent(sponsored(SPONSOR, STRANGER, [{programIndex: 4, dataByte: 2}]), {expectedSigner: USER, expectedFeePayer: SPONSOR}),
    'does not require a signature from your wallet',
  );
});
check('BLOCKS a transaction paid for by neither the user nor the approved sponsor', () => {
  blocks(
    () => assertSolanaTransactionMatchesIntent(sponsored(STRANGER, USER, [{programIndex: 4, dataByte: 2}]), {expectedSigner: USER, expectedFeePayer: SPONSOR}),
    'the expected fee payer',
  );
});
check('without expectedFeePayer, a sponsor-paid transaction is still blocked (the pre-fix, user-pays-only behavior)', () => {
  blocks(() => assertSolanaTransactionMatchesIntent(sponsored(SPONSOR, USER, [{programIndex: 4, dataByte: 2}]), {expectedSigner: USER}), 'not by your wallet');
});

console.log(`${passed}/${passed + failures.length} checks passed`);
for (const failure of failures) console.error(`  FAIL ${failure}`);
if (failures.length > 0) process.exit(1);
