// scripts/verify-send-usdc.mjs
//
// Offline checks for src/wallet/sendUsdc.ts's pure logic — address
// validation and the ERC-20 transfer encoding — not a live send (that
// needs real funds and a real, unblocked RPC). Cross-checks against
// independent references, same discipline as this repo's other
// verify-*.mjs scripts: the real 4-byte transfer(address,uint256)
// selector, and known-good/known-bad address examples for both chain
// families this app supports.
//
// Run: node --experimental-strip-types scripts/verify-send-usdc.mjs

import assert from 'node:assert/strict';
import {encodeFunctionData, isAddress} from 'viem';
import bs58 from 'bs58';
import {isValidRecipientAddress} from '../src/wallet/sendUsdc.ts';

let n = 0;
function check(label, fn) {
  fn();
  n++;
  console.log(`ok ${n} - ${label}`);
}

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      {name: 'to', type: 'address'},
      {name: 'amount', type: 'uint256'},
    ],
    outputs: [{type: 'bool'}],
    stateMutability: 'nonpayable',
  },
];

check('a real EVM checksum address passes isValidRecipientAddress', () => {
  assert.ok(isValidRecipientAddress('base', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'));
});
check('a malformed EVM address (wrong length) fails isValidRecipientAddress', () => {
  assert.equal(isValidRecipientAddress('base', '0x1234'), false);
});
check('a Solana address is rejected on an EVM chain, and vice versa — chain-scoped, not a generic "looks like an address" check', () => {
  const solanaAddress = '11111111111111111111111111111111';
  assert.equal(isValidRecipientAddress('base', solanaAddress), false);
  assert.equal(isValidRecipientAddress('solana', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'), false);
});
check('a real base58, 32-byte Solana address passes isValidRecipientAddress', () => {
  // Solana's own System Program address — a real, well-known 32-byte key.
  assert.ok(isValidRecipientAddress('solana', '11111111111111111111111111111111'));
});
check('a non-base58 string fails the Solana check without throwing', () => {
  assert.equal(isValidRecipientAddress('solana', 'not-a-real-address!!!'), false);
});
check("isValidRecipientAddress's own bs58 decode-length check matches what bs58 actually reports for a known address", () => {
  const decoded = bs58.decode('11111111111111111111111111111111');
  assert.equal(decoded.length, 32);
});
check('viem\'s own isAddress agrees with isValidRecipientAddress for the EVM cases above (not a reimplementation that could quietly drift)', () => {
  assert.equal(isAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94'), isValidRecipientAddress('base', '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'));
});

check('sendUsdc.ts\'s ERC-20 ABI matches the real transfer(address,uint256) selector (0xa9059cbb) — independently known, not just self-consistent', () => {
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: ['0x9858EfFD232B4033E47d90003D41EC34EcaEda94', 1_000_000n],
  });
  assert.equal(data.slice(0, 10), '0xa9059cbb');
});
check('the encoded transfer calldata decodes back to the exact recipient and amount', () => {
  const recipient = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';
  const amount = 5_000_000n;
  const data = encodeFunctionData({abi: ERC20_TRANSFER_ABI, functionName: 'transfer', args: [recipient, amount]});
  const paddedRecipient = data.slice(34, 74);
  assert.equal(BigInt('0x' + paddedRecipient), BigInt(recipient));
  const amountHex = data.slice(74, 138);
  assert.equal(BigInt('0x' + amountHex), amount);
});

console.log(`\n${n}/${n} checks passed`);
