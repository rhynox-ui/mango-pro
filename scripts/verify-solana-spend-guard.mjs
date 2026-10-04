// scripts/verify-solana-spend-guard.mjs
//
// Tests for src/core/solanaSpendGuard.ts — the Solana pre-sign check that
// simulates the exact transaction and compares the wallet's balances
// (audit C-03). An honest trade passes; a route that takes more of the
// spent token, any other token, extra SOL, hands a token account to
// someone else, or adds a delegate is refused. Run via `npm run verify`.

import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';
import {SOLANA_NATIVE_SPEND, SolanaSpendGuardError, assertSolanaSpendWithinIntent, isInsufficientSolSimulation} from '../src/core/solanaSpendGuard.ts';

let checks = 0;
const ok = name => console.log('ok', ++checks, `- ${name}`);
const addr = () => Keypair.generate().publicKey.toBase58();
const USER = addr();
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK = addr();
const JUP = addr();
const ATTACKER = addr();
const E9 = 1_000_000_000n;

function tokenData({mint, owner = USER, amount, delegate = null}) {
  const b = new Uint8Array(165);
  b.set(bs58.decode(mint), 0);
  b.set(bs58.decode(owner), 32);
  let a = BigInt(amount);
  for (let i = 0; i < 8; i++) { b[64 + i] = Number(a & 0xffn); a >>= 8n; }
  if (delegate) { b[72] = 1; b.set(bs58.decode(delegate), 76); }
  return [Buffer.from(b).toString('base64'), 'base64'];
}

// A wallet with USDC, BONK and JUP; `after` describes the simulated result.
function fakeConnection({pre = {usdc: 50_000_000n, bonk: 7_000n, jup: 3n}, preSol = 1n * E9, after = {}, simErr = null, logs = [], extraAccounts = 0} = {}) {
  const accounts = [
    {address: addr(), mint: USDC, amount: pre.usdc},
    {address: addr(), mint: BONK, amount: pre.bonk},
    {address: addr(), mint: JUP, amount: pre.jup},
    ...Array.from({length: extraAccounts}, () => ({address: addr(), mint: addr(), amount: 1n})),
  ];
  const seen = {};
  const parsed = list => ({value: list.map(a => ({pubkey: {toBase58: () => a.address}, account: {data: {parsed: {info: {mint: a.mint, tokenAmount: {amount: a.amount.toString()}}}}}}))});
  return {
    seen,
    getParsedTokenAccountsByOwner: async (_o, {programId}) => parsed(programId === 'T22' ? [] : accounts),
    getBalance: async () => Number(preSol),
    simulateTransaction: async (_tx, config) => {
      seen.addresses = config.accounts.addresses;
      if (simErr) return {value: {err: simErr, logs, accounts: null}};
      const byAddress = new Map(accounts.map(a => [a.address, a]));
      return {
        value: {
          err: null,
          accounts: config.accounts.addresses.map((address, i) => {
            if (i === 0) return {lamports: Number(after.sol ?? preSol - 5_000n), data: ['', 'base64']};
            const a = byAddress.get(address);
            const key = a.mint === USDC ? 'usdc' : a.mint === BONK ? 'bonk' : a.mint === JUP ? 'jup' : null;
            const change = key ? after[key] : undefined;
            if (change === null) return null; // closed
            if (change && typeof change === 'object') return {lamports: 2_039_280, data: tokenData({mint: a.mint, amount: change.amount ?? a.amount, owner: change.owner, delegate: change.delegate})};
            return {lamports: 2_039_280, data: tokenData({mint: a.mint, amount: change ?? a.amount})};
          }),
        },
      };
    },
  };
}
const run = (connection, intent) =>
  assertSolanaSpendWithinIntent(connection, {}, {owner: USER, ownerAddress: USER, intent, tokenProgramIds: ['T', 'T22'], encodeBase58: b => bs58.encode(b)});
const blocked = async (p, re) => {
  await assert.rejects(p, e => e instanceof SolanaSpendGuardError && (!re || re.test(e.message)));
};
const buyWithUsdc = {spend: USDC.toLowerCase(), maxSpend: 10_000_000n};

await run(fakeConnection({after: {usdc: 40_000_000n}}), buyWithUsdc);
ok('an honest USDC buy passes (USDC down by exactly the amount, the new token lands in a new account, SOL down by the fee)');

await blocked(run(fakeConnection({after: {usdc: 39_999_999n}}), buyWithUsdc), /more of your token/);
ok('taking one base unit more USDC than entered is refused');

await blocked(run(fakeConnection({after: {usdc: 40_000_000n, bonk: 0n}}), buyWithUsdc), /didn't choose to spend/);
await blocked(run(fakeConnection({after: {usdc: 40_000_000n, jup: null}}), buyWithUsdc), /didn't choose to spend/);
ok('draining or closing any other token account the wallet holds is refused');

await blocked(run(fakeConnection({after: {usdc: 40_000_000n, bonk: {owner: ATTACKER}}}), buyWithUsdc), /didn't choose to spend/);
await blocked(run(fakeConnection({after: {usdc: 40_000_000n, bonk: {delegate: ATTACKER}}}), buyWithUsdc), /standing authority/);
ok('handing a token account to someone else, or adding a delegate on it, is refused');

await blocked(run(fakeConnection({after: {usdc: 40_000_000n, sol: 1n * E9 - 31_000_000n}}), buyWithUsdc), /more SOL/);
await run(fakeConnection({after: {usdc: 40_000_000n, sol: 1n * E9 - 6_100_000n}}), buyWithUsdc);
ok('SOL may only cover fees and a few new token accounts (0.03 SOL) on a token trade');

const sellSol = {spend: SOLANA_NATIVE_SPEND, maxSpend: E9 / 2n};
await run(fakeConnection({after: {sol: E9 / 2n - 5_000n}}), sellSol);
await blocked(run(fakeConnection({after: {sol: E9 / 2n - 40_000_000n}}), sellSol), /more SOL/);
await blocked(run(fakeConnection({after: {sol: E9 / 2n - 5_000n, usdc: 1n}}), sellSol), /didn't choose to spend/);
ok('spending SOL: the amount entered plus fees passes; more SOL, or any token, is refused');

await blocked(run(fakeConnection({after: {usdc: 39_990_000n}}), buyWithUsdc));
await run(fakeConnection({after: {usdc: 39_990_000n}}), {...buyWithUsdc, extra: [{mint: USDC, units: 10_000n}]});
ok("Mango's own sponsorship recovery is allowed only when it's declared, and only that amount");

await blocked(run(fakeConnection({simErr: {InstructionError: [0, 'Custom']}}), buyWithUsdc), /fails in simulation/);
await assert.rejects(run(fakeConnection({simErr: 'AccountNotFound', logs: ['Transfer: insufficient lamports 100, need 5000']}), buyWithUsdc), e => isInsufficientSolSimulation(e));
await assert.rejects(run(fakeConnection({simErr: {InstructionError: [1, {Custom: 6001}]}}), buyWithUsdc), e => e instanceof SolanaSpendGuardError && !isInsufficientSolSimulation(e));
ok('a failing simulation is never signed; only a lack of SOL is routed to fee sponsorship');

{
  const c = fakeConnection({after: {usdc: 40_000_000n}, extraAccounts: 150});
  await run(c, buyWithUsdc);
  assert.equal(c.seen.addresses.length, 154);
  assert.equal(c.seen.addresses[0], USER);
  const usdcAccount = (await c.getParsedTokenAccountsByOwner(USER, {programId: 'T'})).value.find(a => a.account.data.parsed.info.mint === USDC).pubkey.toBase58();
  assert.equal(c.seen.addresses[1], usdcAccount, 'the spent token account is always among those checked');
  ok('a crowded wallet checks every non-empty token account, with the spent token account first');
}

console.log(`\n${checks} checks passed`);
