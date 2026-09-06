/**
 * Smoke test only — renders the app tree without crashing. Real wallet
 * crypto correctness (BIP-39, SLIP-10 derivation, PBKDF2/AES-GCM) is a
 * job for an offline Node script (mango-mobile's own scripts/verify-
 * wallet-crypto.mjs is the model to follow here), not this test — keys.ts
 * pulls in viem/@solana/web3.js, whose ESM builds would otherwise drag
 * this suite into unrelated Jest/Babel transform configuration rather
 * than testing anything about App's own rendering. Mocked here for
 * exactly that reason, same as mango-mobile's own App.test.tsx.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('../src/wallet/keys', () => ({
  generateMnemonic: () => 'test test test test test test test test test test test junk',
  deriveAccounts: () => ({
    evm: {address: '0x0000000000000000000000000000000000dEaD', privateKey: '0x0'},
    solana: {address: '11111111111111111111111111111111', privateKey: 'x'},
  }),
  isValidMnemonic: () => true,
  normalizeMnemonic: (phrase: string) => phrase,
  suggestBip39Words: () => [],
  warmupCrypto: () => {},
}));

jest.mock('../src/wallet/vault', () => ({
  hasVault: jest.fn(async () => false),
  loadVault: jest.fn(async () => null),
  createVault: jest.fn(async () => {}),
  unlockVaultMnemonic: jest.fn(async () => 'test test test test test test test test test test test junk'),
}));

// react-native-webview's WebView reaches for a real native TurboModule
// (RNCWebViewModule) at import time, which doesn't exist under Jest's
// Node environment — same mock mango-mobile's own App.test.tsx uses for
// the identical reason. Metro's real bundler is what actually exercises
// this module; this smoke test only needs the import chain not to throw.
jest.mock('react-native-webview', () => {
  const {View} = require('react-native');
  return {WebView: View};
});

test('renders correctly with no wallet on the device', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    // Let the hasVault() promise in App's mount effect resolve before
    // the test ends, so its setState lands inside this act() block.
    await Promise.resolve();
  });
  ReactTestRenderer.act(() => {
    renderer.unmount();
  });
});
