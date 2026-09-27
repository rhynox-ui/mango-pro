// scripts/verify-solana-spend-intent.mjs
//
// executeRelayQuote.ts's solanaSpendIntentFor: what a Solana step may
// spend. Native SOL is named by the System Program id (chainData.ts,
// Relay), which the EVM-style native sentinels don't cover — it must
// still count as spending SOL, not as a token "mint". Run via `npm run verify`.

import assert from 'node:assert/strict';
import {buildTransactionIntent} from '../src/core/txIntentFirewall.ts';
import {solanaSpendIntentFor} from '../src/core/executeRelayQuote.ts';
import {SOLANA_NATIVE_SPEND} from '../src/core/solanaSpendGuard.ts';

const base = {originChainId: 792703809, destinationChainId: 8453, destinationCurrency: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', amountBaseUnits: '500000000', userAddress: 'CFqNwTuTkqkaVoNZmNE6q5TeV6CcNwGRns2NSEY72Fu2'};
const sol = solanaSpendIntentFor(buildTransactionIntent({...base, originCurrency: '11111111111111111111111111111111'}));
assert.deepEqual(sol, {spend: SOLANA_NATIVE_SPEND, maxSpend: 500000000n});
console.log('ok 1 - paying native SOL (System Program id) is a SOL spend, capped at the amount');
const usdc = solanaSpendIntentFor(buildTransactionIntent({...base, originCurrency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'}));
assert.deepEqual(usdc, {spend: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'.toLowerCase(), maxSpend: 500000000n});
console.log('ok 2 - paying a token is a spend of that mint (compared case-insensitively by the guard)');
console.log('\n2 checks passed');
