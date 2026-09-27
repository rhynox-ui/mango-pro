/**
 * Render smoke test: mounts the real screens touched by the NEAR, Arc and
 * audit work (trade screen for an EVM token and a NEAR token, search with
 * a NEAR result, history with a NEAR trade) with only the network and
 * native modules stubbed, and checks they render what they should
 * without throwing.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

jest.mock('react-native-webview', () => {
  const {View} = require('react-native');
  return {WebView: (props: object) => <View testID="webview" {...props} />};
});
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const {deriveAccounts} = require('../src/wallet/keys');
const mockSession = deriveAccounts('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
jest.mock('../src/wallet/SessionContext', () => ({useSession: () => ({session: mockSession, setSession: () => {}})}));

const NEAR_TOKEN = 'rust-334.meme-cooking.near';
const json = (body: unknown) => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body))});
const bytes = (v: unknown) => Array.from(Buffer.from(JSON.stringify(v)));

beforeAll(() => {
  (global as any).fetch = jest.fn((url: string, init?: {body?: string}) => {
    const u = String(url);
    if (u.includes('api.dexscreener.com/latest/dex/search')) {
      return json({pairs: [{chainId: 'near', pairAddress: 'p1', baseToken: {address: NEAR_TOKEN, symbol: 'RUST', name: 'Rust'}, priceUsd: '0.01', liquidity: {usd: 50000}, priceChange: {h24: 5}, marketCap: 1000000}]});
    }
    if (u.includes('api.dexscreener.com')) return json({pairs: []});
    if (init?.body && u.includes('near')) {
      const body = JSON.parse(init.body);
      if (body.method === 'query' && body.params?.request_type === 'call_function') {
        if (body.params.method_name === 'ft_metadata') return json({result: {result: bytes({decimals: 18, symbol: 'RUST'})}});
        if (body.params.method_name === 'ft_balance_of') return json({result: {result: bytes('2500000')}});
      }
    }
    return json({});
  });
});

let current: ReactTestRenderer.ReactTestRenderer | null = null;
afterEach(async () => {
  await act(async () => {
    current?.unmount();
    await new Promise(res => setTimeout(res, 800));
  });
  current = null;
});

async function render(el: React.ReactElement) {
  const {ThemeProvider} = require('../src/theme/ThemeContext');
  await act(async () => {
    current = ReactTestRenderer.create(<ThemeProvider>{el}</ThemeProvider>);
  });
  await act(async () => {
    await new Promise(res => setTimeout(res, 50));
  });
  return current!;
}
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => (n.children as unknown[]).filter(c => typeof c === 'string').join(''))
    .join(' | ');

test('trade screen renders for an EVM token', async () => {
  const {TokenTradeScreen} = require('../src/screens/TokenTradeScreen');
  const r = await render(<TokenTradeScreen token={{chainKey: 'base', address: '0x4200000000000000000000000000000000000006', symbol: 'WETH'}} />);
  const t = texts(r);
  expect(t).toContain('Base');
  expect(t).toContain('Buy');
  expect(t).toContain('Sell');
  expect(t).toContain('You pay');
});

test('trade screen renders for a NEAR token (NEAR chain label, USDC on NEAR balance)', async () => {
  const {TokenTradeScreen} = require('../src/screens/TokenTradeScreen');
  const r = await render(<TokenTradeScreen token={{chainKey: 'near', address: NEAR_TOKEN, symbol: 'RUST'}} />);
  const t = texts(r);
  expect(t).toContain('NEAR');
  expect(t).toContain('RUST');
  expect(t).toContain('USDC');
});

test('search renders a NEAR token row with the NEAR label (when NEAR is on)', async () => {
  const {NEAR_ENABLED} = require('../src/core/chainData');
  const {SearchScreen} = require('../src/screens/SearchScreen');
  const r = await render(<SearchScreen onSelectToken={() => {}} />);
  const {TextInput} = require('react-native');
  await act(async () => {
    r.root.findByType(TextInput).props.onChangeText('rust');
  });
  await act(async () => {
    await new Promise(res => setTimeout(res, 700));
  });
  const t = texts(r);
  if (NEAR_ENABLED) expect(t).toContain('NEAR');
  else expect(t).not.toContain('RUST');
});

test('history renders a NEAR trade with its title', async () => {
  const txHistory = require('../src/wallet/txHistory');
  txHistory.addTxHistoryEntry({status: 'success', chainKey: 'near', chainLabel: 'NEAR', isBuySide: true, paySymbol: 'USDC', receiveSymbol: 'RUST', payAmount: '1', receivedAmountFormatted: '100', hashes: ['H'], fromAddress: mockSession.near?.address});
  const {HistoryScreen} = require('../src/screens/HistoryScreen');
  const r = await render(<HistoryScreen onBack={() => {}} />);
  expect(texts(r)).toContain('Bought RUST on NEAR');
  expect(txHistory.explorerUrlFor('near', 'H')).toBe('https://nearblocks.io/txns/H');
});
