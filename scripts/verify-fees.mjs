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

console.log(`\n${checks}/${checks} checks passed`);
