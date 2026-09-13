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
import {Keypair, PublicKey, SystemProgram, TransactionInstruction} from '@solana/web3.js';
import {createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync} from '@solana/spl-token';
import {rewriteAccountCreationFundingInstructions} from '../src/core/executeRelayQuote.ts';

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

// A stand-in programId for the two SystemProgram.createAccount*
// fixtures above — the rewrite only inspects programId to decide
// "is this the SPL Associated Token Account program," so any
// consistent placeholder is fine for the System Program cases, which
// are identified by discriminant, not by this field.
function TOKEN_LIKE_PROGRAM_ID() {
  return new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
}

console.log(`\n${n}/${n} checks passed`);
