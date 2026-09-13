// scripts/verify-solana-fee-sponsor.mjs
//
// Offline checks for rewriteAccountCreationFundingInstructions — the
// one piece of the Solana fee-sponsorship feature where getting the
// account index wrong either breaks the transaction or silently fails
// to fix the real "insufficient lamports" failure it exists to close
// (see executeRelayQuote.ts's own header on the full reasoning).
//
// Deliberately builds every test instruction with the REAL
// @solana/web3.js / @solana/spl-token instruction builders — not
// hand-crafted bytes — so this is also an independent check that the
// hand-verified discriminant values (CreateAccount=0,
// CreateAccountWithSeed=3) actually match what the real libraries
// produce, not just what system_instruction.rs's source says they
// should be.
//
// Run: node --experimental-strip-types scripts/verify-solana-fee-sponsor.mjs

import assert from 'node:assert/strict';
import {ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction} from '@solana/web3.js';
import {createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddressSync} from '@solana/spl-token';
import {
  estimateSponsorshipLamportsCost,
  rewriteAccountCreationFundingInstructions,
  sponsorshipRecoveryUsdcUnits,
  withComputeUnitLimit,
} from '../src/core/executeRelayQuote.ts';

let n = 0;
function check(label, fn) {
  fn();
  n++;
  console.log(`ok ${n} - ${label}`);
}

const user = Keypair.generate().publicKey;
const feePayer = Keypair.generate().publicKey;
const newAccount = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;

function fundingAccountOf(ix) {
  return ix.keys[0].pubkey;
}

check('SystemProgram.createAccount: funding account (index 0) is rewritten to the fee payer', () => {
  const ix = SystemProgram.createAccount({fromPubkey: user, newAccountPubkey: newAccount, lamports: 2_039_280, space: 165, programId: TOKEN_LIKE_PROGRAM_ID()});
  const [rewritten] = rewriteAccountCreationFundingInstructions([ix], feePayer, TransactionInstruction);
  assert.ok(fundingAccountOf(rewritten).equals(feePayer), 'funding account should now be the fee payer');
  assert.ok(rewritten.keys[1].pubkey.equals(newAccount), 'the new account itself must be untouched');
  assert.equal(rewritten.data.readUInt32LE(0), 0, 'sanity: this really is the CreateAccount variant (discriminant 0)');
});

check('SystemProgram.createAccountWithSeed (base != from — the general, 3-key form): funding account (index 0) is rewritten; base account (index 2) is untouched', () => {
  // A distinct base, not the funding account — confirmed against the
  // real library's own output (not assumed) that this is what actually
  // produces the documented 3-key layout: @solana/web3.js's JS builder
  // collapses to a 2-key form when base === from (an optimization the
  // Rust SDK's own docs don't mention), so base must genuinely differ
  // here to exercise the index-2 slot at all.
  const base = Keypair.generate().publicKey;
  const ix = SystemProgram.createAccountWithSeed({
    fromPubkey: user,
    newAccountPubkey: newAccount,
    basePubkey: base,
    seed: 'mango-wsol',
    lamports: 2_039_280,
    space: 165,
    programId: TOKEN_LIKE_PROGRAM_ID(),
  });
  assert.equal(ix.keys.length, 3, 'sanity: base != from should produce the documented 3-key form');
  const [rewritten] = rewriteAccountCreationFundingInstructions([ix], feePayer, TransactionInstruction);
  assert.ok(fundingAccountOf(rewritten).equals(feePayer), 'funding account should now be the fee payer');
  assert.ok(rewritten.keys[2].pubkey.equals(base), 'the base account must be untouched');
  assert.equal(rewritten.data.readUInt32LE(0), 3, 'sanity: this really is the CreateAccountWithSeed variant (discriminant 3)');
});

check('SystemProgram.createAccountWithSeed (base === from — the collapsed 2-key form real DEX routes commonly use): funding account (index 0) is still correctly rewritten', () => {
  const ix = SystemProgram.createAccountWithSeed({
    fromPubkey: user,
    newAccountPubkey: newAccount,
    basePubkey: user,
    seed: 'mango-wsol',
    lamports: 2_039_280,
    space: 165,
    programId: TOKEN_LIKE_PROGRAM_ID(),
  });
  assert.equal(ix.keys.length, 2, 'sanity: base === from collapses to 2 keys in this library — confirmed empirically, not assumed');
  const [rewritten] = rewriteAccountCreationFundingInstructions([ix], feePayer, TransactionInstruction);
  assert.ok(fundingAccountOf(rewritten).equals(feePayer), 'funding account should now be the fee payer even in the collapsed form');
});

check("Associated Token Account program's Create instruction: funding account (index 0) is rewritten", () => {
  const ata = getAssociatedTokenAddressSync(mint, recipient);
  const ix = createAssociatedTokenAccountInstruction(user, ata, recipient, mint);
  const [rewritten] = rewriteAccountCreationFundingInstructions([ix], feePayer, TransactionInstruction);
  assert.ok(fundingAccountOf(rewritten).equals(feePayer), 'funding account should now be the fee payer');
  assert.ok(rewritten.keys[1].pubkey.equals(ata), 'the associated token account address itself must be untouched');
  assert.ok(rewritten.keys[2].pubkey.equals(recipient), 'the wallet the ATA belongs to must be untouched');
});

check('SystemProgram.transfer (a plain SOL transfer, NOT an account-creation instruction) is left completely untouched', () => {
  const ix = SystemProgram.transfer({fromPubkey: user, toPubkey: recipient, lamports: 1_000_000});
  const [rewritten] = rewriteAccountCreationFundingInstructions([ix], feePayer, TransactionInstruction);
  assert.ok(rewritten === ix, 'an unrelated instruction must pass through as the exact same object, not a rebuilt copy');
  assert.ok(fundingAccountOf(rewritten).equals(user), 'the real sender must NOT be silently replaced by the fee payer');
});

check('A same-program instruction the rewrite does not recognize (an unrelated System Program variant) is left completely untouched', () => {
  // Allocate (discriminant 8) — a real System Program instruction that
  // is NOT one of the two account-creating-AND-funding variants this
  // rewrite targets. Confirms the discriminant check is a real filter,
  // not "any System Program instruction gets rewritten."
  const ix = SystemProgram.allocate({accountPubkey: newAccount, space: 165});
  const [rewritten] = rewriteAccountCreationFundingInstructions([ix], feePayer, TransactionInstruction);
  assert.ok(rewritten === ix, 'Allocate must pass through untouched — it has no funding account to rewrite');
});

check('A multi-instruction transaction only rewrites the account-creation instruction, leaving the real swap instruction alone', () => {
  const createIx = SystemProgram.createAccount({fromPubkey: user, newAccountPubkey: newAccount, lamports: 2_039_280, space: 165, programId: TOKEN_LIKE_PROGRAM_ID()});
  const transferIx = SystemProgram.transfer({fromPubkey: user, toPubkey: recipient, lamports: 500_000});
  const [rewrittenCreate, rewrittenTransfer] = rewriteAccountCreationFundingInstructions([createIx, transferIx], feePayer, TransactionInstruction);
  assert.ok(fundingAccountOf(rewrittenCreate).equals(feePayer), 'the account-creation instruction is rewritten');
  assert.ok(fundingAccountOf(rewrittenTransfer).equals(user), 'the real transfer instruction keeps the real user as sender');
});

// ---------------------------------------------------------------------
// Sponsorship cost recovery — estimateSponsorshipLamportsCost,
// sponsorshipRecoveryUsdcUnits, withComputeUnitLimit. See
// executeRelayQuote.ts's own header on this feature for the full design
// contract; these checks pin the pure math, not the network-dependent
// simulate-and-decide flow around it (untestable offline by nature).

check('estimateSponsorshipLamportsCost: base fee only, no account creation', () => {
  const transferIx = SystemProgram.transfer({fromPubkey: user, toPubkey: recipient, lamports: 500_000});
  const cost = estimateSponsorshipLamportsCost([transferIx], 2, 2_039_280);
  assert.equal(cost, 2 * 5000, 'no account creation means no rent added, regardless of the token-account-rent argument passed in');
});

check('estimateSponsorshipLamportsCost: SystemProgram.createAccount — reads the REAL lamports field off the instruction, not the passed-in rent argument', () => {
  const createIx = SystemProgram.createAccount({fromPubkey: user, newAccountPubkey: newAccount, lamports: 2_039_280, space: 165, programId: TOKEN_LIKE_PROGRAM_ID()});
  const cost = estimateSponsorshipLamportsCost([createIx], 2, 999); // a deliberately wrong rent argument
  assert.equal(cost, 2 * 5000 + 2_039_280, 'System.createAccount rent must come from the instruction data itself, never the ATA-rent argument');
});

check('estimateSponsorshipLamportsCost: Associated Token Account create — uses the passed-in rent-exempt lamports (the program computes this internally, so there is nothing to read off the instruction)', () => {
  const ata = getAssociatedTokenAddressSync(mint, recipient);
  const ataIx = createAssociatedTokenAccountInstruction(user, ata, recipient, mint);
  const cost = estimateSponsorshipLamportsCost([ataIx], 2, 2_039_280);
  assert.equal(cost, 2 * 5000 + 2_039_280);
});

check('estimateSponsorshipLamportsCost: both a System.createAccount AND an ATA-create in the same route — costs add', () => {
  const createIx = SystemProgram.createAccount({fromPubkey: user, newAccountPubkey: newAccount, lamports: 2_039_280, space: 165, programId: TOKEN_LIKE_PROGRAM_ID()});
  const ata = getAssociatedTokenAddressSync(mint, recipient);
  const ataIx = createAssociatedTokenAccountInstruction(user, ata, recipient, mint);
  const cost = estimateSponsorshipLamportsCost([createIx, ataIx], 2, 2_039_280);
  assert.equal(cost, 2 * 5000 + 2_039_280 + 2_039_280);
});

check('sponsorshipRecoveryUsdcUnits: real numbers — ~0.00205 SOL at $150/SOL, plus the 1% conversion buffer', () => {
  const lamportsCost = 2_049_280; // ~0.00205 SOL: base fee (2 sigs) + one token account's rent
  const units = sponsorshipRecoveryUsdcUnits(lamportsCost, 150);
  const solCost = lamportsCost / 1e9;
  const expectedUsd = solCost * 150 * 1.01;
  assert.equal(units, Math.round(expectedUsd * 1_000_000), 'must track the live price and the documented 1% buffer exactly, not an independently-rounded approximation');
});

check('sponsorshipRecoveryUsdcUnits: no live SOL price (0, NaN, or missing) never guesses — returns 0, meaning "skip recovery"', () => {
  assert.equal(sponsorshipRecoveryUsdcUnits(2_049_280, 0), 0);
  assert.equal(sponsorshipRecoveryUsdcUnits(2_049_280, NaN), 0);
  assert.equal(sponsorshipRecoveryUsdcUnits(2_049_280, -5), 0);
});

check('sponsorshipRecoveryUsdcUnits: zero or negative cost never guesses — returns 0', () => {
  assert.equal(sponsorshipRecoveryUsdcUnits(0, 150), 0);
  assert.equal(sponsorshipRecoveryUsdcUnits(-1, 150), 0);
});

check('withComputeUnitLimit: no existing SetComputeUnitLimit — prepends one', () => {
  const transferIx = SystemProgram.transfer({fromPubkey: user, toPubkey: recipient, lamports: 500_000});
  const budgetIx = ComputeBudgetProgram.setComputeUnitLimit({units: 42_000});
  const result = withComputeUnitLimit([transferIx], 42_000, budgetIx);
  assert.equal(result.length, 2);
  assert.ok(result[0] === budgetIx, 'the compute-budget instruction must be prepended, not appended');
  assert.ok(result[1] === transferIx, 'the real instruction must be untouched and still present');
});

check('withComputeUnitLimit: an existing SetComputeUnitLimit from Relay\'s own route is REPLACED, not duplicated (two would be a runtime error)', () => {
  const existingBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({units: 200_000});
  const transferIx = SystemProgram.transfer({fromPubkey: user, toPubkey: recipient, lamports: 500_000});
  const newBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({units: 42_000});
  const result = withComputeUnitLimit([existingBudgetIx, transferIx], 42_000, newBudgetIx);
  assert.equal(result.length, 2, 'must not grow — replace in place, never append a second ComputeBudget instruction');
  assert.ok(result[0] === newBudgetIx, 'the stale limit must be replaced with the newly measured one');
  assert.ok(result[1] === transferIx, 'every other instruction, and its position, must be untouched');
});

check('withComputeUnitLimit: a real SPL transfer instruction (the actual recovery instruction) is left alone alongside the budget fix', () => {
  const ata1 = getAssociatedTokenAddressSync(mint, user);
  const ata2 = getAssociatedTokenAddressSync(mint, recipient);
  const transferIx = createTransferInstruction(ata1, ata2, user, 1_000_000);
  const budgetIx = ComputeBudgetProgram.setComputeUnitLimit({units: 4_500});
  const result = withComputeUnitLimit([transferIx], 4_500, budgetIx);
  assert.equal(result.length, 2);
  assert.ok(result.includes(transferIx));
  assert.ok(result.includes(budgetIx));
});

// A stand-in programId for the two SystemProgram.createAccount*
// fixtures above — the rewrite only inspects programId to decide
// "is this the SPL Associated Token Account program," so any
// consistent placeholder is fine for the System Program cases, which
// are identified by discriminant, not by this field.
function TOKEN_LIKE_PROGRAM_ID() {
  return new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
}

console.log(`\n${n}/${n} checks passed`);
