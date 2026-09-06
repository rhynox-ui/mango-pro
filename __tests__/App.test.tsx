/**
 * Smoke test only — renders the app tree without crashing.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// react-native-webview's WebView reaches for a real native TurboModule
// (RNCWebViewModule) at import time, which doesn't exist under Jest's
// Node environment — same mock mango-mobile's own App.test.tsx uses for
// the identical reason. Metro's real bundler is what actually exercises
// this module; this smoke test only needs the import chain not to throw.
jest.mock('react-native-webview', () => {
  const {View} = require('react-native');
  return {WebView: View};
});

test('renders correctly', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  ReactTestRenderer.act(() => {
    renderer.unmount();
  });
});
