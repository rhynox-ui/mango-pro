// scripts/verify-near-cash-moves.mjs
//
// Tests for src/core/nearCashMoves.ts — moving USDC onto and off NEAR
// through NEAR Intents 1Click for Convert. What matters: money is only
// ever quoted to the wallet's own accounts, refunds go back where it came
// from, no Mango fee on a Convert, USDC decimals must agree with 1Click's
// listing, and the NEAR-side deposit is exactly one ft_transfer (plus a
// one-time registration). Run via `npm run verify`.

import assert from 'node:assert/strict';
import {deriveAccounts} from '../src/wallet/keys.ts';
import {NEAR_USDC} from '../src/core/chainData.ts';
import {NEAR_CASH_MOVE_SLIPPAGE_BPS, nearCashMoveChains, nearCashMoveRequest, nearUsdcDepositCall} from '../src/core/nearCashMoves.ts';

let checks = 0;
const session = deriveAccounts('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const tokens = [
  {assetId: `nep141:${NEAR_USDC}`, decimals: 6, blockchain: 'near', symbol: 'USDC', price: 1, priceUpdatedAt: '', contractAddress: NEAR_USDC},
  {assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', decimals: 6, blockchain: 'base', symbol: 'USDC', price: 1, priceUpdatedAt: '', contractAddress: BASE_USDC.toLowerCase()},
  {assetId: 'nep141:bsc-usdc.omft.near', decimals: 18, blockchain: 'bsc', symbol: 'USDC', price: 1, priceUpdatedAt: '', contractAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'},
];

const chains = nearCashMoveChains();
for (const c of ['ethereum', 'base', 'arbitrum', 'bnb', 'avalanche', 'solana']) assert.ok(chains.includes(c), c);
for (const c of ['arc', 'robinhood', 'stable']) assert.ok(!chains.includes(c), c);
console.log('ok', ++checks, `- NEAR pairs only with chains that have both verified USDC and a 1Click listing (${chains.join(', ')})`);

const now = Date.parse('2026-09-27T12:00:00Z');
const onto = nearCashMoveRequest({direction: 'to-near', chainKey: 'base', amountBaseUnits: '2500000', session, tokens, dry: false, now});
assert.equal(onto.request.originAsset, tokens[1].assetId);
assert.equal(onto.request.destinationAsset, tokens[0].assetId);
assert.equal(onto.request.recipient, session.near.address);
assert.equal(onto.request.refundTo, session.evm.address);
assert.equal(onto.request.depositType, 'ORIGIN_CHAIN');
assert.equal(onto.request.refundType, 'ORIGIN_CHAIN');
assert.equal(onto.request.recipientType, 'DESTINATION_CHAIN');
console.log('ok', ++checks, "- onto NEAR: delivered to the wallet's own NEAR account, refunded to its own Base address");

const off = nearCashMoveRequest({direction: 'from-near', chainKey: 'base', amountBaseUnits: '1000000', session, tokens, dry: true, now});
assert.equal(off.request.originAsset, tokens[0].assetId);
assert.equal(off.request.destinationAsset, tokens[1].assetId);
assert.equal(off.request.recipient, session.evm.address);
assert.equal(off.request.refundTo, session.near.address);
assert.equal(off.request.dry, true);
console.log('ok', ++checks, "- off NEAR: delivered to the wallet's own address on the chosen chain, refunded to its NEAR account");

for (const r of [onto, off]) {
  assert.deepEqual(r.request.appFees, []);
  assert.deepEqual(r.expected.appFees, []);
  assert.equal(r.request.slippageTolerance, NEAR_CASH_MOVE_SLIPPAGE_BPS);
  assert.equal(r.request.swapType, 'EXACT_INPUT');
  for (const k of ['originAsset', 'destinationAsset', 'amount', 'recipient', 'recipientType', 'refundTo']) assert.equal(r.expected[k], r.request[k], k);
  assert.equal(r.expected.maxSlippageBps, r.request.slippageTolerance);
}
assert.equal(onto.request.deadline, new Date(now + 60 * 60 * 1000).toISOString());
console.log('ok', ++checks, "- no Mango fee (Convert is free); exact input; what the signed quote must echo is exactly what was asked");

const sol = nearCashMoveRequest({direction: 'to-near', chainKey: 'bnb', amountBaseUnits: '1', session, tokens, dry: true, now});
assert.equal(sol.request.originAsset, 'nep141:bsc-usdc.omft.near');
assert.throws(() => nearCashMoveRequest({direction: 'to-near', chainKey: 'bnb', amountBaseUnits: '1', session, tokens: tokens.map(t => (t.blockchain === 'bsc' ? {...t, decimals: 6} : t)), dry: true, now}), /decimals/);
assert.throws(() => nearCashMoveRequest({direction: 'to-near', chainKey: 'arbitrum', amountBaseUnits: '1', session, tokens, dry: true, now}), /doesn't list/);
assert.throws(() => nearCashMoveRequest({direction: 'to-near', chainKey: 'arc', amountBaseUnits: '1', session, tokens, dry: true, now}), /can't move/);
console.log('ok', ++checks, "- BNB's 18-decimal USDC must match 1Click's listing; unlisted or unsupported chains are refused");

assert.throws(() => nearCashMoveRequest({direction: 'to-near', chainKey: 'base', amountBaseUnits: '0', session, tokens, dry: true, now}), /amount/);
assert.throws(() => nearCashMoveRequest({direction: 'to-near', chainKey: 'base', amountBaseUnits: '5', session: {evm: session.evm, solana: session.solana}, tokens, dry: true, now}), /NEAR account/);
console.log('ok', ++checks, '- a zero amount, or a wallet with no NEAR account, is refused');

const DEP = 'a'.repeat(64);
const unregistered = async (contract, method) => (method === 'storage_balance_of' ? null : {min: '1250000000000000000000'});
const first = await nearUsdcDepositCall(DEP, 1_000_000n, unregistered);
assert.equal(first.receiverId, NEAR_USDC);
assert.deepEqual(first.actions.map(a => a.params.methodName), ['storage_deposit', 'ft_transfer']);
assert.equal(first.actions[0].params.args.account_id, DEP);
assert.equal(first.actions[0].params.deposit, '1250000000000000000000');
assert.deepEqual(first.actions[1].params.args, {receiver_id: DEP, amount: '1000000'});
assert.equal(first.actions[1].params.deposit, '1');
const registered = await nearUsdcDepositCall(DEP, 5n, async () => ({total: '1'}));
assert.deepEqual(registered.actions.map(a => a.params.methodName), ['ft_transfer']);
await assert.rejects(() => nearUsdcDepositCall(DEP, 0n, unregistered));
console.log('ok', ++checks, "- the NEAR-side deposit is one call on NEAR's USDC: [one-time registration] + ft_transfer of exactly the quoted amount");

console.log(`\n${checks} checks passed`);
