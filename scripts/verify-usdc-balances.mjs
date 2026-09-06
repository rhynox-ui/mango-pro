// scripts/verify-usdc-balances.mjs
//
// Offline checks for src/core/usdcBalances.ts's aggregation logic
// (Promise.allSettled across every USDC-supported chain, the per-chain
// success/error shape, and that totalUsd/complete are always internally
// consistent with the individual results) — not a live-balance check,
// since that needs RPC access this sandbox's egress allowlist only
// partially grants (most EVM RPC hosts here return 403; Solana's public
// endpoint happens to be reachable). Assertions below are written to
// hold either way, rather than assuming every call fails — a first
// version of this script that assumed "no network access" broke the
// moment Solana's own RPC turned out to be reachable and returned a
// genuine, correct answer (0 USDC for a fresh address) instead of an error.

import assert from 'node:assert/strict';
import {fetchUsdcPortfolio, USDC_SUPPORTED_CHAINS} from '../src/core/usdcBalances.ts';
import {TOKEN_ADDRESSES} from '../src/core/chainData.ts';

let n = 0;
function check(label, fn) {
  fn();
  n++;
  console.log(`ok ${n} - ${label}`);
}

check('USDC_SUPPORTED_CHAINS is derived from chainData.ts, not a separate hardcoded list', () => {
  assert.deepEqual(new Set(USDC_SUPPORTED_CHAINS), new Set(Object.keys(TOKEN_ADDRESSES.USDC)));
});

check('USDC_SUPPORTED_CHAINS includes solana alongside the EVM chains', () => {
  assert.ok(USDC_SUPPORTED_CHAINS.includes('solana'));
  assert.ok(USDC_SUPPORTED_CHAINS.includes('ethereum'));
  assert.ok(USDC_SUPPORTED_CHAINS.length >= 10);
});

await (async () => {
  // A syntactically real (but not this session's actual) EOA pair —
  // enough for address-parsing code to accept before the network call.
  const fakeSession = {
    evm: {address: '0x000000000000000000000000000000000000dEaD', privateKey: '0x0'},
    solana: {address: '11111111111111111111111111111111', privateKey: 'x'},
  };
  const portfolio = await fetchUsdcPortfolio(fakeSession);
  const okResults = portfolio.results.filter(r => r.status === 'ok');
  const errorResults = portfolio.results.filter(r => r.status === 'error');
  console.log(`   (this run: ${okResults.length} chain(s) reachable, ${errorResults.length} not — sandbox-dependent, not asserted on)`);

  assert.equal(portfolio.results.length, USDC_SUPPORTED_CHAINS.length);
  n++;
  console.log(`ok ${n} - fetchUsdcPortfolio() returns exactly one result per USDC-supported chain, none dropped`);

  assert.ok(portfolio.results.every(r => r.status === 'ok' || r.status === 'error'));
  n++;
  console.log(`ok ${n} - every result is tagged 'ok' or 'error' — no untagged/ambiguous entry`);

  assert.ok(okResults.every(r => typeof r.balance === 'number' && Number.isFinite(r.balance) && r.balance >= 0));
  n++;
  console.log(`ok ${n} - every successful result carries a real, non-negative finite balance — never NaN or a placeholder`);

  assert.ok(errorResults.every(r => typeof r.error === 'string' && r.error.length > 0));
  n++;
  console.log(`ok ${n} - every failed result carries a real, non-empty error message`);

  const expectedTotal = okResults.reduce((sum, r) => sum + r.balance, 0);
  assert.equal(portfolio.totalUsd, expectedTotal);
  n++;
  console.log(`ok ${n} - totalUsd is exactly the sum of the successful chains' balances, nothing more or less`);

  assert.equal(portfolio.complete, errorResults.length === 0);
  n++;
  console.log(`ok ${n} - complete is true only when EVERY chain succeeded, never when even one failed`);
})();

console.log(`\n${n}/${n} checks passed`);
