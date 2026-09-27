// scripts/verify-near-trade.mjs
//
// Tests for src/core/nearTrade.ts — trading NEAR tokens with USDC on
// NEAR. What matters: routes go through the ported route checks and fit
// Mango's relayer, the fee is 0.5% in USDC sent only AFTER the swap is
// confirmed (none on a refund, a share on a partial fill), nothing is
// sent without the balance and storage NEAR to cover it, and a re-quote
// never sends for less than the minimum shown. Run via `npm run verify`.

import assert from 'node:assert/strict';
import {deriveAccounts} from '../src/wallet/keys.ts';
import {NEAR_ENABLED, NEAR_USDC, tradeChainLabel} from '../src/core/chainData.ts';
import {dexScreenerChainForChain, tradeChainForDexScreenerChainId} from '../src/core/dexScreener.ts';
import {DEV_FEE_WALLET_NEAR} from '../src/core/fees.ts';
import {NearTradeError, executeNearTrade, nearTradeFee, pickRelayableRoute, quoteNearTrade} from '../src/core/nearTrade.ts';

let checks = 0;
const ok = name => console.log('ok', ++checks, `- ${name}`);
const session = deriveAccounts('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const USER = session.near.address;
const MEME = 'rust-334.meme-cooking.near';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const fc = (method_name, args, deposit = '0', gas = 30_000_000_000_000) => ({FunctionCall: {method_name, args: b64(args), gas, deposit}});
const tx = (receiver_id, ...actions) => ({NearTransaction: {receiver_id, actions}});

// USDC → MEME (or back) on Rhea, as src/providers/rhea.rs builds it.
function rheaRoute({tokenIn = NEAR_USDC, tokenOut = MEME, amountIn, out = '5000000', min = '4950000', gas = 250_000_000_000_000, register = true} = {}) {
  const msg = JSON.stringify({force: 0, actions: [{pool_id: 1, token_in: tokenIn, token_out: tokenOut, amount_in: String(amountIn), min_amount_out: min}], skip_unwrap_near: true});
  return {
    dex_id: 'Rhea',
    estimated_amount: {amount_out: out},
    worst_case_amount: {amount_out: min},
    execution_instructions: [
      ...(register ? [tx(tokenOut, fc('storage_deposit', {account_id: USER, registration_only: true}, '1250000000000000000000'))] : []),
      tx(tokenIn, fc('ft_transfer_call', {receiver_id: 'v2.ref-finance.near', amount: String(amountIn), msg}, '1', gas)),
    ],
    token_output: `nep141:${tokenOut}`,
  };
}
function routesFetch(build) {
  const seen = [];
  const fetchImpl = async url => {
    const u = new URL(url);
    seen.push(u);
    return {ok: true, json: async () => build(u)};
  };
  return {fetchImpl, seen};
}

// fee: 0.5%, capped at $50
assert.equal(nearTradeFee(10_000_000n), 50_000n);
assert.equal(nearTradeFee(100_000_000_000n), 50_000_000n); // $100k → $50 cap
assert.equal(nearTradeFee(0n), 0n);
ok("Mango's fee is 0.5% of the USDC, capped at $50");

// Buy quote
{
  const {fetchImpl, seen} = routesFetch(u => [rheaRoute({amountIn: u.searchParams.get('amount_in')})]);
  const q = await quoteNearTrade({side: 'buy', token: MEME, payUnits: 10_000_000n, accountId: USER, slippageBps: null, fetchImpl, now: 1});
  assert.equal(q.fee, 50_000n);
  assert.equal(q.swapIn, 9_950_000n);
  assert.equal(seen[0].searchParams.get('amount_in'), '9950000', 'only the amount after the fee is swapped');
  assert.equal(seen[0].searchParams.get('token_in'), `nep141:${NEAR_USDC}`);
  assert.equal(seen[0].searchParams.get('slippage'), '0.01', 'Auto slippage = 1%');
  assert.equal(seen[0].searchParams.get('trader_account_id'), USER);
  assert.equal(q.receiveUnits, 5_000_000n);
  assert.equal(q.minReceiveUnits, 4_950_000n);
  ok('Buy: the fee is set aside from the USDC and only the rest is swapped');
}

// Sell quote
{
  const {fetchImpl} = routesFetch(u => [rheaRoute({tokenIn: MEME, tokenOut: NEAR_USDC, amountIn: u.searchParams.get('amount_in'), out: '20000000', min: '19800000'})]);
  const q = await quoteNearTrade({side: 'sell', token: MEME, payUnits: 777n, accountId: USER, slippageBps: 50, fetchImpl, now: 1});
  assert.equal(q.swapIn, 777n);
  assert.equal(q.fee, 99_000n); // 0.5% of the guaranteed 19.8 USDC
  assert.equal(q.receiveUnits, 20_000_000n - 99_000n);
  assert.equal(q.minReceiveUnits, 19_800_000n - 99_000n);
  ok('Sell: the whole amount is swapped; the fee comes out of the USDC received, sized on the guaranteed minimum');
}

// Relay gas limit + tampering
{
  const big = rheaRoute({amountIn: 9_950_000n, gas: 301_000_000_000_000});
  const evil = rheaRoute({amountIn: 9_950_000n});
  evil.execution_instructions[1].NearTransaction.actions[0] = fc('ft_transfer_call', {receiver_id: 'attacker.near', amount: '9950000', msg: ''}, '1');
  const good = rheaRoute({amountIn: 9_950_000n, out: '4000000', min: '3960000'});
  const picked = pickRelayableRoute([big, evil, good], {accountId: USER, tokenIn: NEAR_USDC, tokenOut: MEME, amountIn: 9_950_000n});
  assert.equal(picked.amountOut, 4_000_000n);
  const {fetchImpl} = routesFetch(() => [evil]);
  await assert.rejects(quoteNearTrade({side: 'buy', token: MEME, payUnits: 10_000_000n, accountId: USER, fetchImpl}), NearTradeError);
  await assert.rejects(quoteNearTrade({side: 'buy', token: 'near', payUnits: 1n, accountId: USER, fetchImpl}), NearTradeError);
  await assert.rejects(quoteNearTrade({side: 'buy', token: NEAR_USDC, payUnits: 1n, accountId: USER, fetchImpl}), NearTradeError);
  ok('routes above the relayer gas cap or failing the route checks are skipped; native NEAR / USDC itself are refused');
}

// Execution harness
const E21 = 10n ** 21n;
function harness({usdc = 10_000_000n, meme = 0n, nearAmount = 20n * E21, storageUsage = 182, feeRegistered = true, results} = {}) {
  const sentBatches = [];
  const view = async (contract, method, args) => {
    if (method === 'ft_balance_of') return String(contract === NEAR_USDC ? usdc : meme);
    if (method === 'storage_balance_of') return args.account_id === DEV_FEE_WALLET_NEAR && !feeRegistered ? null : {total: '1'};
    if (method === 'storage_balance_bounds') return {min: '1250000000000000000000'};
    throw new Error(`unexpected view ${method}`);
  };
  const rpc = async (method, params) => {
    if (method === 'query' && params.request_type === 'view_account') return {amount: nearAmount.toString(), storage_usage: storageUsage};
    throw new Error(`unexpected rpc ${method}`);
  };
  let batch = 0;
  const send = async (_s, calls) => {
    sentBatches.push(calls);
    const r = results[batch++] ?? calls.map(() => ({SuccessValue: ''}));
    return calls.map((_, i) => ({hash: `H${batch}.${i}`, status: {SuccessValue: ''}, result: r[i]}));
  };
  return {sentBatches, opts: {send, view, rpc, ensureAccount: async () => ({created: false}), now: () => 2}};
}
const used = n => ({SuccessValue: b64(String(n))});
async function buyQuote(extra = {}) {
  const {fetchImpl} = routesFetch(u => [rheaRoute({amountIn: u.searchParams.get('amount_in'), ...extra})]);
  return quoteNearTrade({side: 'buy', token: MEME, payUnits: 10_000_000n, accountId: USER, fetchImpl, now: 1});
}

{
  const q = await buyQuote();
  const h = harness({results: [[{SuccessValue: ''}, used(9_950_000n)]]});
  const r = await executeNearTrade(session, q, h.opts);
  assert.equal(r.status, 'ok');
  assert.equal(h.sentBatches.length, 2, 'swap, then fee — two separate sends');
  assert.deepEqual(h.sentBatches[0], q.route.txs, 'exactly the checked route is sent');
  const fee = h.sentBatches[1][0];
  assert.equal(fee.receiverId, NEAR_USDC);
  assert.equal(fee.actions.at(-1).params.methodName, 'ft_transfer');
  assert.equal(fee.actions.at(-1).params.args.receiver_id, DEV_FEE_WALLET_NEAR);
  assert.equal(fee.actions.at(-1).params.args.amount, '50000');
  assert.equal(r.feeCharged, 50_000n);
  assert.deepEqual(r.hashes, ['H1.0', 'H1.1', 'H2.0']);
  ok('a filled swap is sent as checked, then the 0.5% fee in USDC to widekingdom6862.near');
}
{
  const q = await buyQuote();
  const h = harness({results: [[{SuccessValue: ''}, used(0n)]]});
  const r = await executeNearTrade(session, q, h.opts);
  assert.equal(r.status, 'refunded');
  assert.equal(h.sentBatches.length, 1, 'no fee on a refunded swap');
  assert.equal(r.feeCharged, 0n);
  ok('a swap the exchange cancelled (refunded) is reported as such and pays no fee');
}
{
  const q = await buyQuote();
  const h = harness({results: [[{SuccessValue: ''}, used(4_975_000n)]]});
  const r = await executeNearTrade(session, q, h.opts);
  assert.equal(r.status, 'partial');
  assert.equal(h.sentBatches[1][0].actions.at(-1).params.args.amount, '25000', 'half filled → half the fee');
  ok('a partly filled swap pays the same share of the fee');
}
{
  const q = await buyQuote();
  const h = harness({feeRegistered: false, results: [[{SuccessValue: ''}, used(9_950_000n)], [{Failure: {}}]]});
  const r = await executeNearTrade(session, q, h.opts);
  assert.equal(r.status, 'ok');
  assert.equal(h.sentBatches[1][0].actions[0].params.methodName, 'storage_deposit', "registers the fee account on USDC when it isn't yet");
  assert.equal(r.feeCharged, 0n);
  assert.ok(r.feeError, 'a failed fee is reported, not hidden');
  ok("a fee that doesn't go through never turns a completed trade into a failure");
}
{
  const q = await buyQuote();
  const low = harness({usdc: 9_999_999n, results: []});
  await assert.rejects(executeNearTrade(session, q, low.opts), /Not enough USDC/);
  assert.equal(low.sentBatches.length, 0);
  const noNear = harness({nearAmount: 1n * E21, storageUsage: 182, results: []});
  await assert.rejects(executeNearTrade(session, q, noNear.opts), /storage deposit/);
  assert.equal(noNear.sentBatches.length, 0);
  ok("nothing is sent without the USDC to spend or the NEAR the route's storage deposit needs");
}
{
  const q = await buyQuote();
  const h = harness({results: [[{SuccessValue: ''}, used(9_950_000n)]]});
  const worse = await buyQuote({out: '4500000', min: '4400000'});
  await assert.rejects(executeNearTrade(session, q, {...h.opts, now: () => 1 + 60_000, requote: async () => worse}), /price moved/);
  assert.equal(h.sentBatches.length, 0);
  const same = await buyQuote();
  const r = await executeNearTrade(session, q, {...h.opts, now: () => 1 + 60_000, requote: async () => same});
  assert.equal(r.status, 'ok');
  ok('a stale quote is re-fetched first, and never sent for less than the minimum shown');
}

// search / chart: NEAR results appear only once NEAR is switched on
assert.equal(tradeChainForDexScreenerChainId('near'), NEAR_ENABLED ? 'near' : null);
assert.equal(tradeChainForDexScreenerChainId('arc'), 'arc');
assert.equal(tradeChainForDexScreenerChainId('bsc'), 'bnb');
assert.equal(dexScreenerChainForChain('near'), 'near');
assert.equal(tradeChainLabel('near'), 'NEAR');
ok(`NEAR tokens show in search only while NEAR_ENABLED (now ${NEAR_ENABLED}); the chart resolves NEAR pairs by DexScreener's 'near'`);

console.log(`\n${checks} checks passed`);
