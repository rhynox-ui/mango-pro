// scripts/verify-relay-quote.mjs
//
// Offline checks for src/core/relayQuote.ts's summarizeQuote() — the
// field-mapping logic that turns Relay's raw response into what the
// trade screen actually renders. Pure and network-free by design (no
// fetch happens here), so this runs the same everywhere including this
// sandbox, whose egress proxy blocks api.relay.link outright (confirmed:
// a live end-to-end quote request could not be tested from here — this
// script is deliberately scoped to what CAN be verified without network
// access, not a substitute for a real on-device quote request).
//
// Synthetic quote shapes below mirror mango-mobile's own DexScreen.tsx
// summarizeQuote() comments, which cite the exact fields confirmed
// against @relayprotocol/relay-sdk's generated api.d.ts.

import assert from 'node:assert/strict';
import {summarizeQuote} from '../src/core/relayQuote.ts';

let n = 0;
function check(label, fn) {
  fn();
  n++;
  console.log(`ok ${n} - ${label}`);
}

check('summarizeQuote() sums gas + relayer + app fees into totalFeeUsd', () => {
  const quote = {fees: {gas: {amountUsd: '1.20'}, relayer: {amountUsd: '0.30'}, app: {amountUsd: '0.05'}}};
  const summary = summarizeQuote(quote, 18);
  assert.equal(summary.totalFeeUsd, 1.55);
});

check('summarizeQuote() falls back to relayerService when relayer is absent', () => {
  const quote = {fees: {relayerService: {amountUsd: '0.42'}}};
  const summary = summarizeQuote(quote, 18);
  assert.equal(summary.totalFeeUsd, 0.42);
});

check('summarizeQuote() returns null totalFeeUsd when no fee field is present at all — never 0', () => {
  const summary = summarizeQuote({}, 18);
  assert.equal(summary.totalFeeUsd, null);
});

check('summarizeQuote() prefers currencyOut.amountFormatted when Relay provides it directly', () => {
  const quote = {details: {currencyOut: {amountFormatted: '1234.5'}}};
  const summary = summarizeQuote(quote, 18);
  assert.equal(summary.receivedAmountFormatted, '1234.5');
});

check('summarizeQuote() falls back to formatUnits(amount, currency.decimals) when amountFormatted is absent', () => {
  const quote = {details: {currencyOut: {amount: '1000000', currency: {decimals: 6}}}};
  const summary = summarizeQuote(quote, 18);
  assert.equal(summary.receivedAmountFormatted, '1');
});

check("summarizeQuote() uses fallbackDecimals only when Relay's own currency.decimals is missing", () => {
  const quote = {details: {currencyOut: {amount: '1000000000000000000'}}};
  const summary = summarizeQuote(quote, 18);
  assert.equal(summary.receivedAmountFormatted, '1');
});

check('summarizeQuote() reads real USD values straight from currencyIn/currencyOut', () => {
  const quote = {details: {currencyIn: {amountUsd: '10.5'}, currencyOut: {amountUsd: '10.2'}}};
  const summary = summarizeQuote(quote, 18);
  assert.equal(summary.payAmountUsd, 10.5);
  assert.equal(summary.receiveAmountUsd, 10.2);
});

check('summarizeQuote() prefers swapImpact.percent over totalImpact.percent for priceImpactPct', () => {
  const quote = {details: {swapImpact: {percent: '0.5'}, totalImpact: {percent: '0.8'}}};
  const summary = summarizeQuote(quote, 18);
  assert.equal(summary.priceImpactPct, 0.5);
});

check('summarizeQuote() is null-safe on a completely empty/malformed quote — never throws', () => {
  const summary = summarizeQuote({}, 18);
  assert.deepEqual(summary, {
    totalFeeUsd: null,
    etaSeconds: null,
    receivedAmountFormatted: null,
    payAmountUsd: null,
    receiveAmountUsd: null,
    priceImpactPct: null,
  });
});

console.log(`\n${n}/${n} checks passed`);
