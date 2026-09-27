/**
 * Render test with NEAR switched on (as it will be after the live test):
 * a NEAR token shows up in search with the NEAR label, and typing an
 * amount on a NEAR token's trade screen fetches a (mocked) Intear route
 * that passes the route checks and renders the estimate and Mango's fee.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

jest.mock('react-native-webview', () => {
  const {View} = require('react-native');
  return {WebView: (props: object) => <View testID="webview" {...props} />};
});
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../src/core/chainData', () => ({...jest.requireActual('../src/core/chainData'), NEAR_ENABLED: true}));

const {deriveAccounts} = require('../src/wallet/keys');
const mockSession = deriveAccounts('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
jest.mock('../src/wallet/SessionContext', () => ({useSession: () => ({session: mockSession, setSession: () => {}})}));

const RUST = 'rust-334.meme-cooking.near';
const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const json = (body: unknown) => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body))});
const bytes = (v: unknown) => Array.from(Buffer.from(JSON.stringify(v)));
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');

function rheaRoute(amountIn: string, account: string) {
  const msg = JSON.stringify({force: 0, actions: [{pool_id: 1, token_in: USDC, token_out: RUST, amount_in: amountIn, min_amount_out: '990000000000000000000'}], skip_unwrap_near: true});
  return [
    {
      dex_id: 'Rhea',
      estimated_amount: {amount_out: '1000000000000000000000'},
      worst_case_amount: {amount_out: '990000000000000000000'},
      execution_instructions: [
        {NearTransaction: {receiver_id: RUST, actions: [{FunctionCall: {method_name: 'storage_deposit', args: b64({account_id: account, registration_only: true}), gas: 10_000_000_000_000, deposit: '1250000000000000000000'}}]}},
        {NearTransaction: {receiver_id: USDC, actions: [{FunctionCall: {method_name: 'ft_transfer_call', args: b64({receiver_id: 'v2.ref-finance.near', amount: amountIn, msg}), gas: 150_000_000_000_000, deposit: '1'}}]}},
      ],
      token_output: `nep141:${RUST}`,
    },
  ];
}

beforeAll(() => {
  (global as any).fetch = jest.fn((url: string, init?: {body?: string}) => {
    const u = String(url);
    if (u.startsWith('https://router.intear.tech/route')) {
      const q = new URL(u).searchParams;
      return json(rheaRoute(q.get('amount_in')!, q.get('trader_account_id')!));
    }
    if (u.includes('api.dexscreener.com/latest/dex/search')) {
      return json({pairs: [{chainId: 'near', pairAddress: 'p1', baseToken: {address: RUST, symbol: 'RUST', name: 'Rust'}, priceUsd: '0.01', liquidity: {usd: 50000}, priceChange: {h24: 5}, marketCap: 1000000}]});
    }
    if (u.includes('api.dexscreener.com/latest/dex/tokens')) return json({pairs: [{chainId: 'near', pairAddress: 'p1', priceUsd: '0.01', liquidity: {usd: 50000}}]});
    if (init?.body && u.includes('near')) {
      const body = JSON.parse(init.body);
      if (body.method === 'query' && body.params?.request_type === 'call_function') {
        if (body.params.method_name === 'ft_metadata') return json({result: {result: bytes({decimals: 18, symbol: 'RUST'})}});
        if (body.params.method_name === 'ft_balance_of') return json({result: {result: bytes('25000000')}});
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
    await new Promise(res => setTimeout(res, 100));
  });
  return current!;
}
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => (n.children as unknown[]).filter(c => typeof c === 'string' || typeof c === 'number').join(''))
    .join(' | ');

test('search shows a NEAR token with the NEAR label', async () => {
  const {SearchScreen} = require('../src/screens/SearchScreen');
  const r = await render(<SearchScreen onSelectToken={() => {}} />);
  const {TextInput} = require('react-native');
  await act(async () => {
    r.root.findByType(TextInput).props.onChangeText('rust');
  });
  await act(async () => {
    await new Promise(res => setTimeout(res, 3000));
  });
  const t = texts(r);
  expect(t).toContain('RUST');
  expect(t).toContain('NEAR');
});

test('typing an amount on a NEAR token renders the checked route: estimate and fee', async () => {
  const {TokenTradeScreen} = require('../src/screens/TokenTradeScreen');
  const r = await render(<TokenTradeScreen token={{chainKey: 'near', address: RUST, symbol: 'RUST'}} />);
  const {TextInput} = require('react-native');
  await act(async () => {
    r.root.findAllByType(TextInput)[0].props.onChangeText('10');
  });
  // Wait until the quote settles (the wallet-balance loader can restart it
  // once when it finishes; against stubbed networks that takes a while).
  for (let i = 0; i < 60 && (texts(r).includes('Finding the best route') || !texts(r).includes('Fee $')); i++) {
    await act(async () => {
      await new Promise(res => setTimeout(res, 500));
    });
  }
  const t = texts(r);
  expect(t).toContain('1000'); // 1000 RUST estimate (18 decimals)
  expect(t).toContain('Fee $0.05'); // 0.5% of $10, in USDC
  expect(t).not.toContain('No safe route');
});
