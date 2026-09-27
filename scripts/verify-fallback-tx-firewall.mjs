// scripts/verify-fallback-tx-firewall.mjs
//
// Tests for src/core/fallbackTxFirewall.ts — the pre-sign check on the
// generic fallback aggregators (audit C-01). Calldata is built with viem
// against the providers' real ABIs (1inch AggregationRouterV6, 0x
// AllowanceHolder + Settler). A genuine swap passes; every way a
// compromised quote could redirect it is refused. Run via `npm run verify`.

import assert from 'node:assert/strict';
import {encodeFunctionData, toFunctionSelector} from 'viem';
import {FallbackTxRejected, ONEINCH_ROUTER_V6, ZEROX_ALLOWANCE_HOLDERS, ZEROX_SETTLER_REGISTRY, assertFallbackTxMatchesIntent, assertZeroExSettlerRegistered} from '../src/core/fallbackTxFirewall.ts';

let checks = 0;
const ok = name => console.log('ok', ++checks, `- ${name}`);
const TAKER = '0x1111111111111111111111111111111111111111';
const ATTACKER = '0x6666666666666666666666666666666666666666';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PEPE = '0x6982508145454ce325ddbe47a25d4ec3d2311933';
const ZERO = '0x0000000000000000000000000000000000000000';
const EEEE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const SETTLER = '0x7777777777777777777777777777777777777777';
const AH = ZEROX_ALLOWANCE_HOLDERS[0];
const AMOUNT = 10_000_000n;
const BUY = 1_000_000n;

// selectors confirm the ABIs
assert.equal(toFunctionSelector('swap(address,(address,address,address,address,uint256,uint256,uint256),bytes)'), '0x07ed2379');
assert.equal(toFunctionSelector('exec(address,address,uint256,address,bytes)'), '0x2213bc0b');
assert.equal(toFunctionSelector('execute((address,address,uint256),bytes[],bytes32)'), '0x1fff991f');

const swapAbi = [{type: 'function', name: 'swap', inputs: [{type: 'address'}, {type: 'tuple', components: ['srcToken', 'dstToken', 'srcReceiver', 'dstReceiver'].map(n => ({name: n, type: 'address'})).concat(['amount', 'minReturnAmount', 'flags'].map(n => ({name: n, type: 'uint256'})))}, {type: 'bytes'}], outputs: []}];
const unoAbi = n => [{type: 'function', name: n, inputs: Array.from({length: n.startsWith('unoswapTo') ? 5 : 4}, () => ({type: 'uint256'})), outputs: []}];
const execAbi = [{type: 'function', name: 'exec', inputs: [{type: 'address'}, {type: 'address'}, {type: 'uint256'}, {type: 'address'}, {type: 'bytes'}], outputs: []}];
const settleAbi = [{type: 'function', name: 'execute', inputs: [{type: 'tuple', components: [{name: 'recipient', type: 'address'}, {name: 'buyToken', type: 'address'}, {name: 'minAmountOut', type: 'uint256'}]}, {type: 'bytes[]'}, {type: 'bytes32'}], outputs: []}];

const oneInchSwap = ({src = USDC, dst = PEPE, receiver = TAKER, amount = AMOUNT, min = 990_000n} = {}) =>
  encodeFunctionData({abi: swapAbi, functionName: 'swap', args: [ATTACKER, {srcToken: src, dstToken: dst, srcReceiver: ATTACKER, dstReceiver: receiver, amount, minReturnAmount: min, flags: 0n}, '0x']});
const zeroEx = ({operator = SETTLER, token = USDC, amount = AMOUNT, target = SETTLER, recipient = TAKER, buy = PEPE, min = 990_000n} = {}) =>
  encodeFunctionData({abi: execAbi, functionName: 'exec', args: [operator, token, amount, target, encodeFunctionData({abi: settleAbi, functionName: 'execute', args: [{recipient, buyToken: buy, minAmountOut: min}, [], `0x${'00'.repeat(32)}`]})]});

const base1inch = (over = {}) => ({provider: '1inch', quote: {to: ONEINCH_ROUTER_V6, data: oneInchSwap(), value: '0', allowanceTarget: ONEINCH_ROUTER_V6, buyAmount: BUY.toString(), ...over}, sellToken: USDC, buyToken: PEPE, sellAmount: AMOUNT, taker: TAKER});
const base0x = (over = {}) => ({provider: '0x', quote: {to: AH, data: zeroEx(), value: '0', allowanceTarget: AH, buyAmount: BUY.toString(), ...over}, sellToken: USDC, buyToken: PEPE, sellAmount: AMOUNT, taker: TAKER});
const rejects = (args, re) => assert.throws(() => assertFallbackTxMatchesIntent(args), e => e instanceof FallbackTxRejected && (!re || re.test(e.message)));

assert.deepEqual(assertFallbackTxMatchesIntent(base1inch()), {settler: null});
assertFallbackTxMatchesIntent(base1inch({data: oneInchSwap({receiver: ZERO})}));
ok("a genuine 1inch swap passes (router, exact input, the wallet as recipient, a real minimum)");

rejects(base1inch({to: USDC, allowanceTarget: USDC, data: `0xa9059cbb${ATTACKER.slice(2).padStart(64, '0')}${AMOUNT.toString(16).padStart(64, '0')}`}), /router/);
rejects(base1inch({data: `0xa9059cbb${ATTACKER.slice(2).padStart(64, '0')}${AMOUNT.toString(16).padStart(64, '0')}`}), /doesn't sign/);
ok('a token transfer dressed up as a quote is refused (wrong contract, or an unknown function on the router)');

rejects(base1inch({allowanceTarget: ATTACKER}), /approval/);
rejects(base1inch({value: '1'}), /native/);
rejects(base1inch({data: oneInchSwap({amount: AMOUNT * 100n})}), /different amount/);
rejects(base1inch({data: oneInchSwap({receiver: ATTACKER})}), /someone else/);
rejects(base1inch({data: oneInchSwap({src: PEPE})}), /different tokens/);
rejects(base1inch({data: oneInchSwap({dst: ATTACKER})}), /different tokens/);
rejects(base1inch({data: oneInchSwap({min: 0n})}), /minimum/);
rejects(base1inch({data: oneInchSwap({min: 979_999n})}), /minimum/);
ok('1inch: approval to a stranger, extra native value, a bigger spend, another recipient, other tokens, a gutted minimum — all refused');

const uno = (name, args) => encodeFunctionData({abi: unoAbi(name), functionName: name, args});
assertFallbackTxMatchesIntent(base1inch({data: uno('unoswap', [BigInt(USDC), AMOUNT, 990_000n, 123n])}));
assertFallbackTxMatchesIntent(base1inch({data: uno('unoswapTo', [BigInt(TAKER), BigInt(USDC), AMOUNT, 990_000n, 123n])}));
rejects(base1inch({data: uno('unoswapTo', [BigInt(ATTACKER), BigInt(USDC), AMOUNT, 990_000n, 123n])}), /someone else/);
rejects(base1inch({data: uno('unoswap', [BigInt(PEPE), AMOUNT, 990_000n, 123n])}), /different token/);
rejects(base1inch({data: uno('unoswap', [BigInt(USDC) | (1n << 255n), AMOUNT + 1n, 990_000n, 123n])}), /different amount/);
ok("1inch unoswap: input token, amount, recipient and minimum are checked (flag bits in 1inch's Address type are ignored)");

assertFallbackTxMatchesIntent({...base1inch({value: AMOUNT.toString(), allowanceTarget: null, data: oneInchSwap({src: EEEE})}), sellToken: ZERO});
rejects({...base1inch({value: '0', allowanceTarget: null, data: oneInchSwap({src: EEEE})}), sellToken: ZERO}, /native/);
ok('selling the native coin: the value must be exactly the amount, and no approval');

assert.deepEqual(assertFallbackTxMatchesIntent(base0x()), {settler: SETTLER.toLowerCase()});
rejects(base0x({to: ATTACKER, allowanceTarget: ATTACKER}), /AllowanceHolder/);
rejects(base0x({data: zeroEx({operator: ATTACKER})}), /different contract/);
rejects(base0x({data: zeroEx({token: PEPE})}), /different token/);
rejects(base0x({data: zeroEx({amount: AMOUNT + 1n})}), /different amount/);
rejects(base0x({data: zeroEx({recipient: ATTACKER})}), /someone else/);
rejects(base0x({data: zeroEx({buy: ATTACKER})}), /different token/);
rejects(base0x({data: zeroEx({min: 1n})}), /minimum/);
ok('0x: a genuine AllowanceHolder → Settler swap passes; any other contract, spender, token, amount, recipient or minimum is refused');

const reader = ({current = SETTLER, previous = ATTACKER, paused = false} = {}) => async ({address, functionName}) => {
  assert.equal(address, ZEROX_SETTLER_REGISTRY);
  if (functionName === 'ownerOf') {
    if (paused) throw new Error('reverted');
    return current;
  }
  return previous;
};
await assertZeroExSettlerRegistered(SETTLER, reader());
await assertZeroExSettlerRegistered(SETTLER, reader({current: ATTACKER, previous: SETTLER}));
await assert.rejects(assertZeroExSettlerRegistered(SETTLER, reader({current: ATTACKER, previous: ATTACKER})), FallbackTxRejected);
await assert.rejects(assertZeroExSettlerRegistered(SETTLER, reader({paused: true})), FallbackTxRejected);
ok("0x's Settler must be the registry's current (or, during 0x's rollout, previous) deployment; a paused registry refuses");

console.log(`\n${checks} checks passed`);
