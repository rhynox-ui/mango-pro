// scripts/verify-execute-relay-quote.mjs
//
// Offline checks for the one thing that's actually safe to verify
// without a live network or real funds: that executeRelayQuote()
// genuinely refuses to sign anything — before touching a wallet client
// or the network at all — when the intent tag relayQuote.ts attaches
// is missing, stale, or doesn't match the quote's own steps. This is
// the real integration point neither verify-tx-intent-firewall.mjs
// (tests the firewall functions in isolation, with hand-built objects)
// nor verify-relay-quote.mjs (tests quote-fetching, pre-execution) ever
// exercises together: relayQuote.ts tagging a real quote object via
// getRelayQuote(), and executeRelayQuote.ts reading that exact tag back
// off the exact same object.
//
// What this does NOT and CANNOT verify offline: that a legitimate quote
// actually signs and broadcasts successfully — that needs a real RPC,
// a real chain, and real funds. See executeRelayQuote.ts's own header
// for what's ported from where and why.
//
// Run: node --experimental-strip-types scripts/verify-execute-relay-quote.mjs

import assert from 'node:assert/strict';
import {TransactionIntentError} from '../src/core/txIntentFirewall.ts';

let n = 0;
function check(label, fn) {
  fn();
  n++;
  console.log(`ok ${n} - ${label}`);
}
async function checkAsync(label, fn) {
  await fn();
  n++;
  console.log(`ok ${n} - ${label}`);
}

const USER_EVM = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const ONE_ETH = (10n ** 18n).toString();

const fakeSession = {
  evm: {address: USER_EVM, privateKey: '0x1111111111111111111111111111111111111111111111111111111111111111'},
  solana: {address: '11111111111111111111111111111111', privateKey: '11111111111111111111111111111111111111111111111111111111111111111111111111111111'},
};

function fakeRelayResponse({steps, details}) {
  return {
    details: details ?? {
      currencyIn: {amount: ONE_ETH, currency: {chainId: 8453, address: '0x0000000000000000000000000000000000000000'}},
      currencyOut: {currency: {chainId: 8453, address: USDC_BASE}},
      recipient: USER_EVM,
    },
    steps,
  };
}

function withStubbedFetch(responseBody, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ok: true, status: 200, json: async () => responseBody});
  return fn().finally(() => {
    globalThis.fetch = realFetch;
  });
}

await (async () => {
  const {getRelayQuote} = await import('../src/core/relayQuote.ts');
  const {executeRelayQuote} = await import('../src/core/executeRelayQuote.ts');

  await checkAsync('a quote object that never went through getRelayQuote() is refused — no recorded intent, zero network/signing attempted', async () => {
    const untaggedQuote = fakeRelayResponse({steps: []});
    await assert.rejects(() => executeRelayQuote(untaggedQuote, fakeSession), /no recorded intent/i);
  });

  await checkAsync('a real, freshly-tagged quote whose steps target the WRONG chain is blocked by the firewall before any signing is attempted', async () => {
    await withStubbedFetch(
      fakeRelayResponse({
        steps: [
          {
            kind: 'transaction',
            requestId: 'req-1',
            items: [{status: 'pending', data: {chainId: 1, to: '0x2222222222222222222222222222222222222222', data: '0xdeadbeef', value: ONE_ETH}}],
          },
        ],
      }),
      async () => {
        const quote = await getRelayQuote({
          fromChainKey: 'base',
          toChainKey: 'base',
          originCurrency: '0x0000000000000000000000000000000000000000',
          destinationCurrency: USDC_BASE,
          amountBaseUnits: ONE_ETH,
          userAddress: USER_EVM,
        });
        let threw = null;
        try {
          await executeRelayQuote(quote, fakeSession);
        } catch (err) {
          threw = err;
        }
        assert.ok(threw instanceof TransactionIntentError, `expected TransactionIntentError, got ${threw?.constructor?.name}: ${threw?.message}`);
        assert.match(threw.message, /not the chain you chose/i);
      },
    );
  });

  await checkAsync('a real, freshly-tagged quote with an unlimited approval to a stranger is blocked before signing (the classic drain)', async () => {
    const MAX_UINT256 = 2n ** 256n - 1n;
    const word = value => BigInt(value).toString(16).padStart(64, '0');
    const addrWord = address => address.slice(2).toLowerCase().padStart(64, '0');
    const stranger = '0x3333333333333333333333333333333333333333';
    const router = '0x4444444444444444444444444444444444444444';
    const approveCalldata = `0x095ea7b3${addrWord(stranger)}${word(MAX_UINT256)}`;

    await withStubbedFetch(
      fakeRelayResponse({
        details: {
          currencyIn: {amount: '1000000', currency: {chainId: 8453, address: USDC_BASE}},
          currencyOut: {currency: {chainId: 8453, address: '0x0000000000000000000000000000000000000000'}},
          recipient: USER_EVM,
        },
        steps: [
          {
            kind: 'transaction',
            requestId: 'req-2',
            items: [
              {status: 'pending', data: {chainId: 8453, to: USDC_BASE, data: approveCalldata, value: '0'}},
              {status: 'pending', data: {chainId: 8453, to: router, data: '0xdeadbeef', value: '0'}},
            ],
          },
        ],
      }),
      async () => {
        const quote = await getRelayQuote({
          fromChainKey: 'base',
          toChainKey: 'base',
          originCurrency: USDC_BASE,
          destinationCurrency: '0x0000000000000000000000000000000000000000',
          amountBaseUnits: '1000000',
          userAddress: USER_EVM,
        });
        let threw = null;
        try {
          await executeRelayQuote(quote, fakeSession);
        } catch (err) {
          threw = err;
        }
        assert.ok(threw instanceof TransactionIntentError, `expected TransactionIntentError, got ${threw?.constructor?.name}: ${threw?.message}`);
        assert.match(threw.message, /no transaction in this route calls that address/i);
      },
    );
  });

  await checkAsync('a real quote tagged more than 2 minutes ago is refused for staleness before the firewall (or signing) ever runs', async () => {
    const RealDate = Date;
    await withStubbedFetch(fakeRelayResponse({steps: []}), async () => {
      const quote = await getRelayQuote({
        fromChainKey: 'base',
        toChainKey: 'base',
        originCurrency: '0x0000000000000000000000000000000000000000',
        destinationCurrency: USDC_BASE,
        amountBaseUnits: ONE_ETH,
        userAddress: USER_EVM,
      });
      class FutureDate extends RealDate {
        static now() {
          return RealDate.now() + 3 * 60 * 1000;
        }
      }
      // eslint-disable-next-line no-global-assign
      globalThis.Date = FutureDate;
      try {
        await assert.rejects(() => executeRelayQuote(quote, fakeSession), /too old to sign safely/i);
      } finally {
        globalThis.Date = RealDate;
      }
    });
  });
})();

console.log(`\n${n}/${n} checks passed`);
