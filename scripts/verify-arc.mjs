// scripts/verify-arc.mjs
//
// Pins the Arc-specific rules. On Arc, USDC is both the gas token and an
// ERC-20: eth_getBalance reports it with 18 decimals, the ERC-20 at
// 0x3600… with 6. Mixing the two is a 10^12 error, and spending the whole
// balance leaves nothing to pay the gas. Run via `npm run verify`.

import assert from 'node:assert/strict';
import {
  ARC_USDC,
  MAINNET_CHAIN_IDS,
  NATIVE_SYMBOL,
  currencyAddress,
  assetDecimalsForChain,
  chainKeyForChainId,
} from '../src/core/chainData.ts';
import {CHAIN_KEY_TO_VIEM_CHAIN, RPC_FALLBACKS, viemChainForChainId} from '../src/core/chainRegistry.ts';
import {SPONSORSHIP_COST_ESTIMATE_USD} from '../src/core/fees.ts';
import {ARC_GAS_RESERVE_USDC, CASH_ASSET_BY_CHAIN, spendableCash, spendableTotalUsd} from '../src/core/usdcBalances.ts';
import {arcUsdcSpendInNativeUnits} from '../src/core/executeRelayQuote.ts';
import {isGaslessSupportedOnChain} from '../src/wallet/smartAccount.ts';

let checks = 0;

assert.equal(MAINNET_CHAIN_IDS.arc, 5042);
assert.equal(chainKeyForChainId(5042), 'arc');
console.log('ok', ++checks, '- Arc is chain 5042 and resolves back to its ChainKey');

assert.equal(NATIVE_SYMBOL.arc, 'USDC');
assert.equal(currencyAddress('arc', 'USDC'), ARC_USDC);
assert.equal(ARC_USDC, '0x3600000000000000000000000000000000000000');
assert.notEqual(currencyAddress('arc', 'USDC'), '0x0000000000000000000000000000000000000000');
console.log('ok', ++checks, '- Arc USDC resolves to the 6-decimal ERC-20, never the 18-decimal 0x0 sentinel');

assert.equal(assetDecimalsForChain('arc', 'USDC'), 6);
console.log('ok', ++checks, '- Arc USDC amounts are built with 6 decimals');

assert.equal(CASH_ASSET_BY_CHAIN.arc, 'USDC');
console.log('ok', ++checks, '- Arc USDC counts toward the cash balance');

const arcChain = CHAIN_KEY_TO_VIEM_CHAIN.arc;
assert.ok(arcChain);
assert.equal(arcChain.id, 5042);
assert.equal(arcChain.nativeCurrency.decimals, 18);
assert.ok(arcChain.rpcUrls.default.http.length > 0);
assert.ok((RPC_FALLBACKS[5042] || []).length >= 2);
assert.equal(viemChainForChainId(5042), arcChain);
console.log('ok', ++checks, '- Arc viem chain has real RPCs and 18-decimal native currency');

assert.ok(SPONSORSHIP_COST_ESTIMATE_USD.arc > 0);
console.log('ok', ++checks, '- Arc has a sponsorship cost floor');

assert.equal(spendableCash('arc', 10), 10 - ARC_GAS_RESERVE_USDC);
assert.equal(spendableCash('arc', ARC_GAS_RESERVE_USDC / 2), 0);
assert.equal(spendableCash('base', 10), 10);
const portfolio = {
  results: [
    {chainKey: 'arc', asset: 'USDC', status: 'ok', balance: 5},
    {chainKey: 'base', asset: 'USDC', status: 'ok', balance: 3},
    {chainKey: 'solana', asset: 'USDC', status: 'error', error: 'rpc down'},
  ],
  totalUsd: 8,
  complete: false,
};
assert.equal(spendableTotalUsd(portfolio), 8 - ARC_GAS_RESERVE_USDC);
assert.equal(spendableTotalUsd(null), 0);
console.log('ok', ++checks, '- MAX leaves a gas reserve on Arc and only on Arc');

assert.equal(arcUsdcSpendInNativeUnits(5042, ARC_USDC, 1_000_000n), 10n ** 18n);
assert.equal(arcUsdcSpendInNativeUnits(5042, ARC_USDC.toUpperCase().replace('0X', '0x'), 2_500_000n), 25n * 10n ** 17n);
assert.equal(arcUsdcSpendInNativeUnits(8453, ARC_USDC, 1_000_000n), 0n);
assert.equal(arcUsdcSpendInNativeUnits(5042, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 1_000_000n), 0n);
assert.equal(arcUsdcSpendInNativeUnits(5042, undefined, 1_000_000n), 0n);
assert.equal(arcUsdcSpendInNativeUnits(5042, ARC_USDC, undefined), 0n);
console.log('ok', ++checks, '- Arc pre-flight counts the USDC being spent against the 18-decimal gas balance');

assert.equal(isGaslessSupportedOnChain(5042), false);
assert.equal(isGaslessSupportedOnChain(8453), true);
console.log('ok', ++checks, '- Arc never takes the Pimlico gasless path');

console.log(`\n${checks} checks passed`);
