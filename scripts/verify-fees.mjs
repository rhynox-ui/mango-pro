// scripts/verify-fees.mjs
//
// Pins src/core/fees.ts's exported constants and appFeeBps() behavior.
// This exists specifically because DEV_FEE_PCT already drifted silently
// once in this family of apps (mango-telegram-bot charged users double
// the intended rate for weeks before it was caught) — a future edit to
// this file that changes the effective rate should fail a test, not
// ship silently. Run via `npm run verify`.

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '..');

// fees.ts is plain TypeScript with no RN-specific imports, so Node's own
// native type-stripping (--experimental-strip-types, run via `node`'s
// shebang-free invocation below) reads it directly — no bundler needed
// now that this is a bare React Native app rather than a Vite project.
const fees = await import(`file://${path.join(repoRoot, 'src/core/fees.ts')}?t=${Date.now()}`);

let checks = 0;

assert.equal(fees.DEV_FEE_WALLET, '0xf07becc2401a646fff10d10b969ef18b03582e88');
console.log('ok', ++checks, '- DEV_FEE_WALLET is the real, documented protocol fee wallet');

assert.equal(fees.DEV_FEE_PCT, 0.005);
console.log('ok', ++checks, '- DEV_FEE_PCT is 0.5%, matching the site/mobile (not the bot\'s once-stale 1%)');

assert.equal(fees.DEV_FEE_MAX_USD, 50);
console.log('ok', ++checks, '- DEV_FEE_MAX_USD caps the dollar fee at $50 on large trades');

assert.equal(fees.appFeeBps(), '50');
console.log('ok', ++checks, '- appFeeBps() with no amount returns the flat 50bps rate');

assert.equal(fees.appFeeBps(100), '50');
console.log('ok', ++checks, '- appFeeBps() stays flat for a trade far below the $50 cap threshold');

// $50 cap / $20,000 * 10000 = 25bps — below this, the flat 50bps would
// exceed $50, so the rate must be reduced.
assert.equal(fees.appFeeBps(20_000), '25');
console.log('ok', ++checks, '- appFeeBps() caps the effective rate once the flat rate would exceed $50');

assert.equal(fees.appFeeBps(-5), '50');
console.log('ok', ++checks, '- appFeeBps() falls back to the flat rate for a non-positive amount, never divides by it');

assert.equal(fees.feeRecipientForQuote(), fees.DEV_FEE_WALLET);
console.log('ok', ++checks, '- feeRecipientForQuote() always returns the EVM wallet, even though DEV_FEE_WALLET_SOLANA exists');

// --- Chain-aware sponsorship fee floor -------------------------------
// Pins the fix for a real gap: outright gas sponsorship on an expensive
// chain (Ethereum mainnet) can cost more than the flat 0.5% collects on
// a small trade, quietly losing money instead of earning margin.

assert.equal(fees.sponsoredFeeFloorUsd('ethereum'), 2.55);
console.log('ok', ++checks, '- sponsoredFeeFloorUsd(ethereum) is the mainnet gas-cost estimate plus the minimum margin');

assert.equal(fees.appFeeBpsForSponsoredTrade('ethereum', 10), fees.appFeeBps(10));
console.log('ok', ++checks, '- appFeeBpsForSponsoredTrade() with no sponsorship option is identical to appFeeBps()');

assert.equal(fees.appFeeBpsForSponsoredTrade('ethereum', 10, {sponsoringGasOutright: true}), '2550');
console.log(
  'ok',
  ++checks,
  '- appFeeBpsForSponsoredTrade() raises the rate on a small Ethereum-mainnet trade so sponsoring its gas cannot lose money',
);

// Not '51': 0.001 + 0.05 isn't exactly representable in binary float
// (0.051000000000000004), and Math.ceil() rounds that up — the correct,
// safe direction for a cost floor to err in (charges a hair more, never
// less), so 52 is the right answer here, not a bug to chase to 51.
assert.equal(fees.appFeeBpsForSponsoredTrade('solana', 10, {sponsoringGasOutright: true}), '52');
console.log('ok', ++checks, "- appFeeBpsForSponsoredTrade() barely adjusts a small Solana trade — sponsorship there is nearly free");

assert.equal(fees.appFeeBpsForSponsoredTrade('ethereum', 10_000, {sponsoringGasOutright: true}), fees.appFeeBps(10_000));
console.log('ok', ++checks, '- appFeeBpsForSponsoredTrade() never raises the rate once the flat fee already covers the sponsorship floor');

assert.equal(fees.shouldPreferPayGasInToken('ethereum', 10), true);
console.log('ok', ++checks, '- shouldPreferPayGasInToken() flags a small Ethereum-mainnet trade as too costly to sponsor outright');

assert.equal(fees.shouldPreferPayGasInToken('solana', 10), false);
console.log('ok', ++checks, '- shouldPreferPayGasInToken() does not flag Solana, where sponsorship is cheap at any real trade size');

assert.equal(fees.shouldPreferPayGasInToken('ethereum', 10_000), false);
console.log('ok', ++checks, '- shouldPreferPayGasInToken() does not flag a large Ethereum trade, where the flat fee already covers gas');

console.log(`\n${checks}/${checks} checks passed`);
