// scripts/verify-open-positions.mjs
//
// Offline test vectors for src/wallet/openPositions.ts's pure
// aggregation logic (computeOpenPositions) — no network, no wallet.
// withLiveValues (the live-price half) isn't covered here since it's a
// thin network call over resolveDexScreenerPair, already covered by
// that module's own real-usage in TokenChartPanel.
//
// Run: node --experimental-strip-types scripts/verify-open-positions.mjs

import assert from 'node:assert/strict';
import {computeClosedPositions, computeOpenPositions} from '../src/wallet/openPositions.ts';

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

const BASE_ENTRY = {
  id: 'x',
  timestamp: 0,
  status: 'success',
  chainKey: 'base',
  chainLabel: 'Base',
  hashes: ['0xabc'],
};

function buy({timestamp, tokenAddress, symbol, amount, imageUrl}) {
  return {...BASE_ENTRY, timestamp, isBuySide: true, paySymbol: 'USDC', receiveSymbol: symbol, payAmount: '1', receivedAmountFormatted: String(amount), tokenAddress, tokenImageUrl: imageUrl ?? null};
}
function sell({timestamp, tokenAddress, symbol, amount}) {
  return {...BASE_ENTRY, timestamp, isBuySide: false, paySymbol: symbol, receiveSymbol: 'USDC', payAmount: String(amount), receivedAmountFormatted: '1', tokenAddress, tokenImageUrl: null};
}

check('a single Buy shows as an open position with the bought amount', () => {
  const positions = computeOpenPositions([buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100})]);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].amountHeld, 100);
  assert.equal(positions[0].symbol, 'PEPE');
});

check('a Buy fully offset by a Sell of the same size closes the position (not shown)', () => {
  const positions = computeOpenPositions([buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}), sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100})]);
  assert.equal(positions.length, 0);
});

check('a partial Sell leaves the real remainder as the open amount', () => {
  const positions = computeOpenPositions([buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}), sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'PEPE', amount: 40})]);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].amountHeld, 60);
});

check('two different tokens on the same chain are two separate positions', () => {
  const positions = computeOpenPositions([buy({timestamp: 1, tokenAddress: '0xTokenA', symbol: 'AAA', amount: 10}), buy({timestamp: 2, tokenAddress: '0xTokenB', symbol: 'BBB', amount: 20})]);
  assert.equal(positions.length, 2);
});

check('the SAME token address on two different chains is NOT merged into one position', () => {
  const positions = computeOpenPositions([
    buy({timestamp: 1, tokenAddress: '0xSameAddress', symbol: 'AAA', amount: 10}),
    {...buy({timestamp: 2, tokenAddress: '0xSameAddress', symbol: 'AAA', amount: 20}), chainKey: 'bnb', chainLabel: 'BNB Chain'},
  ]);
  assert.equal(positions.length, 2, 'expected one position per chain even though the token address is identical');
});

check('EVM token addresses are compared case-insensitively', () => {
  const positions = computeOpenPositions([buy({timestamp: 1, tokenAddress: '0xABCDEF', symbol: 'AAA', amount: 10}), buy({timestamp: 2, tokenAddress: '0xabcdef', symbol: 'AAA', amount: 5})]);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].amountHeld, 15);
});

check('Solana mint addresses are compared case-SENSITIVELY', () => {
  const positions = computeOpenPositions([
    {...buy({timestamp: 1, tokenAddress: 'AbCdEf', symbol: 'AAA', amount: 10}), chainKey: 'solana', chainLabel: 'Solana'},
    {...buy({timestamp: 2, tokenAddress: 'abcdef', symbol: 'AAA', amount: 5}), chainKey: 'solana', chainLabel: 'Solana'},
  ]);
  assert.equal(positions.length, 2, 'expected two positions — Solana addresses differing only in case are different mints');
});

check('an errored trade never contributes to a position', () => {
  const positions = computeOpenPositions([{...buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}), status: 'error'}]);
  assert.equal(positions.length, 0);
});

check('an entry with no tokenAddress (written before the field existed) is skipped, not guessed at', () => {
  const entry = buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100});
  delete entry.tokenAddress;
  const positions = computeOpenPositions([entry]);
  assert.equal(positions.length, 0);
});

check('a later trade\'s imageUrl overrides an earlier trade with none', () => {
  const positions = computeOpenPositions([buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 10}), buy({timestamp: 2, tokenAddress: '0xToken', symbol: 'PEPE', amount: 10, imageUrl: 'https://example.com/pepe.png'})]);
  assert.equal(positions[0].imageUrl, 'https://example.com/pepe.png');
});

check('a Buy fully offset by a Sell shows as ONE closed position, not two trade rows', () => {
  const closed = computeClosedPositions([buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}), sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100})]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].symbol, 'PEPE');
  assert.equal(closed[0].lastTradeAt, 2);
});

check('a token still partially held does NOT show as closed', () => {
  const closed = computeClosedPositions([buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}), sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'PEPE', amount: 40})]);
  assert.equal(closed.length, 0);
});

check('a token bought, sold, then bought again shows as open, not closed', () => {
  const closed = computeClosedPositions([
    buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}),
    sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}),
    buy({timestamp: 3, tokenAddress: '0xToken', symbol: 'PEPE', amount: 50}),
  ]);
  assert.equal(closed.length, 0, 'expected no closed position — the token is open again after the second buy');
  const open = computeOpenPositions([
    buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}),
    sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}),
    buy({timestamp: 3, tokenAddress: '0xToken', symbol: 'PEPE', amount: 50}),
  ]);
  assert.equal(open.length, 1);
  assert.equal(open[0].amountHeld, 50);
});

check('multiple round-trips on the same token collapse into ONE closed row, not one per trade', () => {
  const closed = computeClosedPositions([
    buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}),
    sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'PEPE', amount: 100}),
    buy({timestamp: 3, tokenAddress: '0xToken', symbol: 'PEPE', amount: 50}),
    sell({timestamp: 4, tokenAddress: '0xToken', symbol: 'PEPE', amount: 50}),
  ]);
  assert.equal(closed.length, 1, 'five raw trades on one token should still be exactly one closed position row');
  assert.equal(closed[0].lastTradeAt, 4);
});

check('a real round-trip with rounding leftover (not exactly zero) still shows as closed', () => {
  // Regression: DUST_EPSILON used to be a fixed 1e-9, but payAmount/
  // receivedAmountFormatted are already-rounded display strings, not
  // base units — a real sell of a large-amount buy routinely leaves a
  // remainder many orders of magnitude bigger than 1e-9 (slippage
  // between the buy and sell price, formatting rounding on both sides).
  // A wallet that had genuinely fully exited never showed as closed.
  const closed = computeClosedPositions([
    buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'BREW', amount: 1_284_991.4213}),
    sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'BREW', amount: 1_284_988.7706}), // leftover ~2.65, not ~0
  ]);
  assert.equal(closed.length, 1, 'a real-world rounding leftover should still read as closed');
  const open = computeOpenPositions([
    buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'BREW', amount: 1_284_991.4213}),
    sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'BREW', amount: 1_284_988.7706}),
  ]);
  assert.equal(open.length, 0, 'the same trade pair should not ALSO show as open');
});

check('a genuinely large remainder (not just rounding) still shows as open, not closed', () => {
  // The relative threshold must not swallow a real, meaningful holding
  // just because it's small relative to a huge original buy.
  const closed = computeClosedPositions([buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'BREW', amount: 1_000_000}), sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'BREW', amount: 900_000})]);
  assert.equal(closed.length, 0, 'a real 10% remaining holding must not be marked closed');
  const open = computeOpenPositions([buy({timestamp: 1, tokenAddress: '0xToken', symbol: 'BREW', amount: 1_000_000}), sell({timestamp: 2, tokenAddress: '0xToken', symbol: 'BREW', amount: 900_000})]);
  assert.equal(open.length, 1);
  assert.equal(open[0].amountHeld, 100_000);
});

check('closed positions across different tokens sort newest-closed first', () => {
  const closed = computeClosedPositions([
    buy({timestamp: 1, tokenAddress: '0xTokenA', symbol: 'AAA', amount: 10}),
    sell({timestamp: 2, tokenAddress: '0xTokenA', symbol: 'AAA', amount: 10}),
    buy({timestamp: 3, tokenAddress: '0xTokenB', symbol: 'BBB', amount: 10}),
    sell({timestamp: 9, tokenAddress: '0xTokenB', symbol: 'BBB', amount: 10}),
  ]);
  assert.equal(closed.length, 2);
  assert.equal(closed[0].symbol, 'BBB', 'expected the most recently closed token first');
});

console.log(`${passed}/${passed + failures.length} checks passed`);
for (const failure of failures) console.error(`  FAIL ${failure}`);
if (failures.length > 0) process.exit(1);
