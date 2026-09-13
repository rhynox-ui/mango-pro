// scripts/verify-evm-sponsorship-recovery.mjs
//
// Offline checks for the EVM half of sponsorship cost recovery —
// evmSponsorshipRecoveryUsdcUnits (executeRelayQuote.ts) and
// chainKeyForChainId (chainData.ts). See executeRelayQuote.ts's own
// header on this section for the full design contract (shared with the
// Solana half in scripts/verify-solana-fee-sponsor.mjs): recover real
// cost, live-priced, plus a small non-profit conversion buffer, and
// never guess.
//
// What this does NOT and CANNOT verify offline: the actual
// prepareUserOperation-then-decide flow inside sendRelayEvmStepSponsored
// needs a real Pimlico bundler, a real chain, and a real funded account
// — see this file's own header for why that split (prepare to measure,
// prepare again as the real pre-flight, then exactly one broadcast) is
// safe by construction even though it can't be exercised here.
//
// Run: node --experimental-strip-types scripts/verify-evm-sponsorship-recovery.mjs

import assert from 'node:assert/strict';
import {evmSponsorshipRecoveryUsdcUnits} from '../src/core/executeRelayQuote.ts';
import {chainKeyForChainId, MAINNET_CHAIN_IDS} from '../src/core/chainData.ts';

let n = 0;
function check(label, fn) {
  fn();
  n++;
  console.log(`ok ${n} - ${label}`);
}

check('chainKeyForChainId: resolves every real chain id back to its own key (exact inverse of MAINNET_CHAIN_IDS)', () => {
  for (const [key, id] of Object.entries(MAINNET_CHAIN_IDS)) {
    assert.equal(chainKeyForChainId(id), key, `chain id ${id} should resolve back to "${key}"`);
  }
});

check('chainKeyForChainId: an unknown chain id returns undefined, never a guess', () => {
  assert.equal(chainKeyForChainId(999999999), undefined);
});

check('evmSponsorshipRecoveryUsdcUnits: real numbers — 0.0003 ETH worth of gas at $3000/ETH, 6-decimal USDC', () => {
  const nativeCostWei = 300_000_000_000_000n; // 0.0003 ETH
  const units = evmSponsorshipRecoveryUsdcUnits(nativeCostWei, 3000, 6);
  const expectedUsd = 0.0003 * 3000 * 1.01;
  assert.equal(units, BigInt(Math.round(expectedUsd * 1_000_000)), 'must track the live price and the documented 1% buffer exactly');
});

check('evmSponsorshipRecoveryUsdcUnits: BNB Chain\'s own 18-decimal USDC is honored when passed explicitly, not assumed to be 6', () => {
  const nativeCostWei = 1_000_000_000_000_000n; // 0.001 BNB
  const units6 = evmSponsorshipRecoveryUsdcUnits(nativeCostWei, 600, 6);
  const units18 = evmSponsorshipRecoveryUsdcUnits(nativeCostWei, 600, 18);
  assert.equal(units18, units6 * 10n ** 12n, 'the only difference between the two should be the decimal scale, same underlying USD amount');
});

check('evmSponsorshipRecoveryUsdcUnits: no live native price (0, NaN, negative) never guesses — returns 0n', () => {
  assert.equal(evmSponsorshipRecoveryUsdcUnits(300_000_000_000_000n, 0, 6), 0n);
  assert.equal(evmSponsorshipRecoveryUsdcUnits(300_000_000_000_000n, NaN, 6), 0n);
  assert.equal(evmSponsorshipRecoveryUsdcUnits(300_000_000_000_000n, -5, 6), 0n);
});

check('evmSponsorshipRecoveryUsdcUnits: zero or negative gas cost never guesses — returns 0n', () => {
  assert.equal(evmSponsorshipRecoveryUsdcUnits(0n, 3000, 6), 0n);
  assert.equal(evmSponsorshipRecoveryUsdcUnits(-1n, 3000, 6), 0n);
});

console.log(`\n${n}/${n} checks passed`);
