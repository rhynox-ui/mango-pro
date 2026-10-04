// src/screens/TokenTradeScreen.tsx
//
// Mango Pro's own trade screen — reused, not hand-built, from
// mango-mobile's own src/wallet/DexScreen.tsx: the exact same Buy/Sell
// pill row, quick-percent row, and You pay/You receive card layout,
// carrying over its real style values (999px pills, gain/danger-bordered
// Buy/Sell, 14px cards, 10px uppercase card labels at 0.6 letter-spacing)
// rather than approximating them by eye. Per the explicit product
// decision behind this screen: Mango Pro has no Limit/DCA — there is no
// Swap/Limit/DCA segmented control above this at all — so the chart
// keeps the vertical space that row would have cost it.
//
// What's real here versus what's a placeholder, stated plainly:
// - The chart (TokenChartPanel) is real, live DexScreener data.
// - Both Buy- and Sell-side quotes are real, live Relay quotes
//   (src/core/relayQuote.ts) once a wallet is unlocked. Sell needs one
//   extra step Buy doesn't: converting a typed token amount into base
//   units needs that token's on-chain decimals, which an arbitrary
//   searched token doesn't carry in DexScreener's own search response —
//   fetched live (src/wallet/walletRpc.ts's fetchErc20TokenMetadata /
//   fetchSplMintDecimals) the moment a token is selected, cached
//   forever after (a token's decimals can never change once deployed).
// - Balances are real too. Mango Pro is USDC-first, not chain-first: Buy
//   always spends this wallet's ONE aggregate USDC balance across every
//   supported chain (src/core/usdcBalances.ts's fetchCashPortfolio,
//   the same total ProfileScreen's own Total Cash shows) — there is no
//   user-facing chain picker, no native-asset payment option, nothing
//   to choose. Internally, Relay still needs one concrete origin chain
//   per quote, so the execution planner can split a unified Buy across
//   multiple source chains and route each leg directly to the destination.
//   The user never has to see or manage those source-chain legs. Sell
//   spends the searched token's own
//   real on-chain balance and always delivers proceeds as that same
//   aggregate USDC (native only on the rare chain with no verified
//   cash address at all).
// - Execution is real on both sides: tapping Buy/Sell runs the quote
//   through src/core/txIntentFirewall.ts (via executeRelayQuote.ts)
//   before signing anything, then signs and broadcasts directly with
//   the session's own key — same non-custodial, direct-broadcast model
//   as every other send in this app.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {formatUnits, parseUnits} from 'viem';
import {TokenChartPanel} from '../components/TokenChartPanel';
import {AssetIcon} from '../components/AssetIcon';
import {ChevronLeftIcon} from '../components/icons';
import {NetworkIcon} from '../wallet/NetworkIcon';
import {CHAIN_LABEL, NATIVE_SYMBOL, assetDecimalsForChain, currencyAddress, tradeChainLabel, type ChainKey, type TradeChain} from '../core/chainData';
import {DEV_FEE_PCT} from '../core/fees';
import {resolveDexScreenerPair} from '../core/dexScreener';
import {NEAR_USDC, NEAR_USDC_DECIMALS} from '../core/chainData';
import {executeNearTrade, fetchNearTokenBalance, fetchNearTokenMeta, quoteNearTrade, NearSendError, type NearTradeQuote} from '../core/nearTrade';
import {getRelayQuote, summarizeQuote, type GetRelayQuoteParams, type QuoteSummary, type RelayQuote} from '../core/relayQuote';
import {executeRelayQuote, getPartialTxHashes, type ExecuteStep} from '../core/executeRelayQuote';
import {loadGaslessTradingEnabled} from '../settings/gaslessTradingPrefs';
import {checkFallbackRoute, fetchLiveTokenPriceUsd, sweepFallbackFeeFromNativeBalance, sweepFallbackFeeFromSolanaBalance, tryFallbackProviders, type FallbackRouteParams} from '../core/fallbackDex';
import {fetchWalletPrices} from '../core/walletPrices';
import {TransactionIntentError} from '../core/txIntentFirewall';
import {describeTradeError} from '../core/tradeErrors';
import {fetchErc20TokenMetadata, fetchSplMintDecimals, fetchWalletNativeBalance, fetchWalletSolanaBalance, fetchWalletSplTokenBalance, fetchWalletTokenBalance} from '../wallet/walletRpc';
import {formatAmountForInput, useAvailableBalance} from '../wallet/useAvailableBalance';
import {addTxHistoryEntry} from '../wallet/txHistory';
import {markOwnAction} from '../wallet/depositWatcher';
import {useSession} from '../wallet/SessionContext';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {TradeSettingsSheet} from '../components/TradeSettingsSheet';
import {TradeResultModal, type TradeResultSummary} from '../components/TradeResultModal';
import {cashLogoUrl, fetchCashPortfolio, spendableCash, spendableTotalUsd, CASH_ASSET_BY_CHAIN, CASH_SUPPORTED_CHAINS, type CashPortfolio} from '../core/usdcBalances';

/**
 * Buy-side only — which chain the user's cash actually gets spent from.
 * Sell has no equivalent: you can only sell a token from the chain it's
 * actually held on, there's no origin to pick. Always resolves to
 * whichever real asset CASH_ASSET_BY_CHAIN names for that chain — USDC
 * almost everywhere, USDG on Robinhood Chain — auto-picked (see the
 * effect that sets this) from wherever the wallet's balance actually is,
 * never a user-facing choice: the user sees one USDC balance, not a
 * chain to pick. This is still tracked internally because Relay's own
 * quote API needs one concrete origin chain per call.
 */
type PayOrigin = {chainKey: ChainKey};

type MultiSourceLeg = {
  chainKey: ChainKey;
  amountUsd: number;
  quote: RelayQuote;
  params: GetRelayQuoteParams;
};

export type DemoToken = {
  /** A Relay chain, or 'near' — a NEAR token trades through nearTrade.ts instead of Relay. */
  chainKey: TradeChain;
  address: string;
  symbol: string;
  /** Real token image from wherever this token was picked (HomeScreen's DiscoveryToken / SearchScreen's TokenSearchResult both already carry one) — optional because the default demo token and any other bare construction site has none; AssetIcon below falls back to a lettered badge rather than fabricating one. */
  imageUrl?: string | null;
  /** Current market cap carried from discovery/search when available; captured into trade history on successful buys. */
  marketCapUsd?: number | null;
};

// A real, highly-liquid token so the chart genuinely resolves a
// DexScreener pair — this is a UI sample, not a live trading session,
// but the chart underneath it is not a mock.
const DEFAULT_DEMO_TOKEN: DemoToken = {
  chainKey: 'ethereum',
  address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
  symbol: 'PEPE',
};

const QUICK_PCT_OPTIONS = [0.25, 0.5, 0.75, 1] as const;

// Investigated a real user report of price impact reading 11%, 20%, up
// to 225% on different tokens: this is NOT a units/calculation bug on
// our side — relayQuote.ts's priceImpactPct is Relay's own
// details.swapImpact.percent, confirmed against the SDK's own types
// (see that file's comment), and 200%+ is a real, correctly-computed
// number for a tiny trade against a pump.fun-thin pool (a market cap of
// a few thousand dollars means even a $1-2 trade can move the pool's
// marginal price by multiples, not just percent). The number was real;
// what was missing was anything stopping a trade at that number. Above
// this threshold the trade is blocked outright rather than merely shown
// in red, since a 200%+ impact is not "a worse price" but a trade that
// hands most of its value straight to the pool.
const EXTREME_PRICE_IMPACT_PCT = 50;

// A quote round-trip is a real network call, not instant — debouncing
// this means typing doesn't fire a request per keystroke.
const QUOTE_DEBOUNCE_MS = 450;

function formatFeePct(rate: number): string {
  return (rate * 100).toFixed(2).replace(/\.?0+$/, '');
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  return `~${Math.round(seconds / 60)}m`;
}

/**
 * The cash asset's own real logo (USDC/USDG, via cashLogoUrl's verified
 * Trust Wallet address) — NetworkIcon renders the CHAIN's icon, which
 * would be wrong for a stablecoin riding on top of it, so this needed
 * its own source. Falls back to the same honest-generic "$" mark
 * ProfileScreen's own Total-cash icon already uses (never a fabricated
 * brand mark) when chainKey has no confirmed logo URL, or the real one
 * fails to load.
 */
function CashBadge({chainKey, size = 16}: {chainKey: ChainKey; size?: number}) {
  const {colors} = useTheme();
  const [failed, setFailed] = useState(false);
  const url = cashLogoUrl(chainKey);
  const s = StyleSheet.create({
    circle: {width: size, height: size, borderRadius: size / 2, backgroundColor: colors.pillBg, alignItems: 'center', justifyContent: 'center'},
    sign: {fontSize: size * 0.6, fontWeight: '800', color: colors.textPrimary},
    image: {width: size, height: size, borderRadius: size / 2},
  });
  if (url && !failed) {
    return <Image source={{uri: url}} style={s.image} onError={() => setFailed(true)} />;
  }
  return (
    <View style={s.circle}>
      <Text style={s.sign}>$</Text>
    </View>
  );
}

// Same formatting ProfileScreen's own "Total Cash" row already uses —
// kept as its own small local copy rather than importing across screens
// for one two-line function, same as this file's other format* helpers.
function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function SearchGlyph({color}: {color: string}) {
  return (
    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="11" cy="11" r="8" />
      <Path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

function SettingsGlyph({color}: {color: string}) {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <Circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function TokenTradeScreen({
  token = DEFAULT_DEMO_TOKEN,
  onOpenSearch,
  onBack,
}: {
  token?: DemoToken;
  onOpenSearch?: () => void;
  // Only passed when this screen was opened by picking a specific token
  // (from Search) rather than tapping the Swap tab directly — the tab
  // itself has nowhere to "go back" to (same as any other bottom-tab
  // root), but a token opened from a search result reads as having been
  // drilled into, and there was no way back to that search without this.
  onBack?: () => void;
}) {
  const {colors} = useTheme();
  const {session} = useSession();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // A NEAR token trades through nearTrade.ts — NEAR's own DEXes, paid in
  // USDC on NEAR, gas covered by Mango's NEAR relayer — instead of Relay.
  // It reuses every piece of this screen; only the quote, balance and
  // execution below branch on it, and no Relay path ever runs for it.
  const nearToken = token.chainKey === 'near';
  const nativeToken = token.chainKey !== 'near' && token.address === currencyAddress(token.chainKey, NATIVE_SYMBOL[token.chainKey]);

  // true = Buy (paying the chain's native asset, receiving the token);
  // false = Sell (paying the token, receiving native) — same isNativeAsset
  // convention DexScreen.tsx already uses for which side is "from".
  const [isBuySide, setIsBuySide] = useState(true);
  // Security screen's own opt-in toggle (gaslessTradingPrefs.ts) —
  // loaded once here so handleTrade below always reads the latest
  // saved preference without re-hitting AsyncStorage on every trade.
  const [gaslessTradingEnabled, setGaslessTradingEnabled] = useState(false);
  useEffect(() => {
    loadGaslessTradingEnabled().then(setGaslessTradingEnabled);
  }, []);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<QuoteSummary | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteRequestIdRef = useRef(0);
  // The raw quote object, kept alongside its summary — executeRelayQuote
  // needs the actual RelayQuote (steps + the intent relayQuote.ts tagged
  // it with), not the display-only numbers summarizeQuote() derives.
  const rawQuoteRef = useRef<RelayQuote | null>(null);
  // Direct source -> destination legs for FOMO-style unified buys.
  const multiSourcePlanRef = useRef<MultiSourceLeg[]>([]);
  // The NEAR equivalent of rawQuoteRef (nearToken only): the checked route
  // plus fee that handleNearTrade sends.
  const nearQuoteRef = useRef<NearTradeQuote | null>(null);
  // The exact params the current rawQuoteRef was requested with — lets
  // handleTrade ask relayQuote.ts for a fresh quote against identical
  // inputs (same pair, same amount, same slippage) if execution's own
  // sponsored-retry logic (executeRelayQuote.ts) finds the locked-in
  // quote reverting on-chain twice in a row, a real sign of price drift
  // on a thin pool rather than a one-off blip the first retry rides out.
  const lastQuoteParamsRef = useRef<GetRelayQuoteParams | null>(null);
  // Set only when Relay itself has no route and a fallback DEX aggregator
  // (fallbackDex.ts) could quote this pair instead — mutually exclusive
  // with rawQuoteRef above (exactly one of the two is non-null whenever
  // `quote` is non-null). handleTrade below re-quotes fresh against these
  // params rather than reusing the preview amount, same as the Relay path
  // re-executes the exact quote it locked in rather than a display value.
  const fallbackParamsRef = useRef<FallbackRouteParams | null>(null);

  type ExecuteState = 'idle' | ExecuteStep | 'success' | 'error';
  const [executeState, setExecuteState] = useState<ExecuteState>('idle');
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executeWarnings, setExecuteWarnings] = useState<string[]>([]);
  const [executeTxHashes, setExecuteTxHashes] = useState<string[]>([]);
  // Snapshot of what was actually traded, taken at the moment of
  // success — never the live isBuySide/paySymbol/receiveSymbol/amount,
  // which keep tracking whatever's currently typed and would drift the
  // instant the modal is open and something behind it re-renders.
  const [lastTrade, setLastTrade] = useState<TradeResultSummary | null>(null);
  const [resultModalDismissed, setResultModalDismissed] = useState(false);

  // null = Auto, Relay's own front-running-aware default (no
  // slippageTolerance sent at all — see relayQuote.ts's own header).
  // Edited only inside TradeSettingsSheet; this is the single source of
  // truth passed straight into getRelayQuote() below.
  const [slippageBps, setSlippageBps] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Real product decision: Mango Pro is USDC-first, not chain-first. The
  // user thinks in one USDC balance; Mango thinks in chains. A Buy always
  // spends cash (USDC everywhere it exists, USDG on Robinhood — resolved
  // via CASH_ASSET_BY_CHAIN, never shown to the user as a different
  // currency), auto-sourced from whichever chain actually holds it —
  // there is no user-facing native-asset payment option and no manual
  // "pick a chain" step any more (see the effect below). payOrigin still
  // carries a real chainKey internally, because Relay's own quote API
  // needs one concrete origin chain per call — hiding chain complexity
  // from the user doesn't mean removing chain awareness from execution.
  const [payOrigin, setPayOrigin] = useState<PayOrigin>({chainKey: token.chainKey === 'near' ? CASH_SUPPORTED_CHAINS[0] : token.chainKey});

  // Sell always delivers proceeds as cash too — same reasoning as Buy
  // above, no user-facing toggle. The one real, disclosed gap: a chain
  // with no verified cash address at all (CASH_SUPPORTED_CHAINS doesn't
  // cover every chain this app can chart a token on, e.g. Plasma/X
  // Layer) has nothing to convert proceeds INTO, so those still land as
  // the chain's own native asset — an honest limitation, not a choice
  // offered to the user.
  const receiveAsset: 'native' | 'cash' = token.chainKey === 'near' || CASH_SUPPORTED_CHAINS.includes(token.chainKey) ? 'cash' : 'native';

  // Same real, live aggregator ProfileScreen's own "Total Cash" already
  // uses — reused here rather than re-derived, so this screen's own
  // portfolio figure can never quietly drift from the one on Profile.
  const [cashPortfolio, setCashPortfolio] = useState<CashPortfolio | null>(null);
  useEffect(() => {
    if (!session) {
      setCashPortfolio(null);
      return;
    }
    let cancelled = false;
    fetchCashPortfolio(session).then(portfolio => {
      if (!cancelled) setCashPortfolio(portfolio);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Silently picks whichever chain actually holds this wallet's biggest
  // cash balance and routes the Buy from there — no user-facing "Pay
  // from" step. When nothing has a balance yet (fresh wallet, or
  // cashPortfolio still loading), falls back to a real cash-supported
  // chain rather than the token's own chain if that chain has none
  // (e.g. Plasma/X Layer) — always a chain execution can actually use,
  // never token.chainKey blindly.
  //
  // Keyed on [token, cashPortfolio] — not cashPortfolio alone. Real bug
  // this fixes, live-confirmed across three separate tokens/chains
  // (Ethereum, Solana, Robinhood): cashPortfolio is fetched once per
  // session and rarely changes again, so a `[cashPortfolio]`-only effect
  // only ever ran ONCE, the first time a real cash balance appeared.
  // Every token switch after that needed its OWN re-run (a Buy's payable
  // chain is per-token state) but got none, since nothing in
  // cashPortfolio itself had changed — leaving payOrigin silently stuck
  // on whatever it was for the previous token.
  useEffect(() => {
    let best: {chainKey: ChainKey; balance: number} | null = null;
    for (const result of cashPortfolio?.results ?? []) {
      if (result.status !== 'ok') continue;
      // Spendable, not raw: an Arc balance that is all gas reserve can't pay.
      const spendable = spendableCash(result.chainKey, result.balance);
      if (spendable <= 0) continue;
      if (!best || spendable > best.balance) best = {chainKey: result.chainKey, balance: spendable};
    }
    const tokenChain = token.chainKey;
    const fallbackChain = tokenChain !== 'near' && CASH_SUPPORTED_CHAINS.includes(tokenChain) ? tokenChain : CASH_SUPPORTED_CHAINS[0];
    setPayOrigin({chainKey: best ? best.chainKey : fallbackChain});
  }, [token, cashPortfolio]);

  // Always the literal, user-facing label "USDC" on Buy — per the
  // product decision above, the user never sees which real asset (USDC,
  // or USDG on Robinhood) or which chain actually backs it; that's
  // Mango's own routing concern, not a second currency shown to the
  // user. Execution still resolves the REAL asset via
  // CASH_ASSET_BY_CHAIN[payOrigin.chainKey] wherever it actually moves
  // funds — this is a display-only simplification, not a change to what
  // gets signed.
  const paySymbol = isBuySide ? 'USDC' : token.symbol;
  const receiveSymbol = isBuySide ? token.symbol : token.chainKey === 'near' || receiveAsset === 'cash' ? 'USDC' : NATIVE_SYMBOL[token.chainKey];
  const amtNum = Number(amount) || 0;

  // Real USD value of what's actually being paid on Buy — cash (USDC or
  // USDG, both real 1:1 pegs) is trivially 1:1, no price lookup needed.
  // Feeds getRelayQuote's own originAmountUsd (the large-trade fee cap)
  // and the fallback-DEX path's fee cap/sweep.
  const originAmountUsd = isBuySide ? amtNum : undefined;

  // The searched token's own decimals — not carried by DexScreener's
  // search response, so Sell (which spends this token) needs a live
  // on-chain read before it can convert a typed amount into base units.
  // Buy never needs this: it always spends the chain's native asset,
  // whose decimals chainData.ts already knows statically.
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(null);
  const [tokenDecimalsError, setTokenDecimalsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTokenDecimals(null);
    setTokenDecimalsError(null);
    const chainKey = token.chainKey;
    const lookup =
      chainKey === 'near'
        ? fetchNearTokenMeta(token.address).then(meta => meta.decimals)
        : nativeToken
          ? Promise.resolve(assetDecimalsForChain(chainKey, NATIVE_SYMBOL[chainKey]) ?? 18)
          : chainKey === 'solana'
            ? fetchSplMintDecimals(token.address)
            : fetchErc20TokenMetadata(chainKey, token.address).then(meta => meta.decimals);
    lookup
      .then(decimals => {
        if (cancelled) return;
        setTokenDecimals(decimals);
      })
      .catch(err => {
        if (cancelled) return;
        setTokenDecimalsError(err instanceof Error ? err.message : "Couldn't verify this token.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, nativeToken]);

  const solana = token.chainKey === 'solana';
  // Which chain the PAY side's balance actually needs to be read from —
  // payOrigin's own choice on Buy, always the token's own chain on Sell
  // (reduces to `solana` there, same value as before this feature).
  const originIsSolana = isBuySide ? payOrigin.chainKey === 'solana' : solana;

  // The real "how much can I spend" answer the quick-percent row below
  // needs. Buy: the WHOLE wallet's USDC balance across every chain
  // (cashPortfolio.totalUsd — the exact same aggregate ProfileScreen's
  // own Total Cash shows), never just the one chain payOrigin happens to
  // be auto-routing from right now — see this file's own header on why
  // the user thinks in one balance, not per-chain ones. Sell: the
  // searched token itself (tokenDecimals, resolved above; unresolved yet
  // just means no balance to report, same reasoning the quote effect
  // below already applies).
  const fetchPayBalance = useCallback((): Promise<number> => {
    if (!session) return Promise.resolve(0);
    if (token.chainKey === 'near') {
      // A NEAR trade spends from the wallet's NEAR account only: USDC on
      // NEAR to buy, the token itself to sell.
      const nearAccount = session.near;
      if (!nearAccount) return Promise.resolve(0);
      if (isBuySide) return fetchNearTokenBalance(NEAR_USDC, nearAccount.address).then(units => Number(formatUnits(units, NEAR_USDC_DECIMALS)));
      if (tokenDecimals === null) return Promise.resolve(0);
      return fetchNearTokenBalance(token.address, nearAccount.address).then(units => Number(formatUnits(units, tokenDecimals)));
    }
    if (isBuySide) {
      // Spendable total: Arc's gas reserve comes out of its USDC balance.
      return Promise.resolve(spendableTotalUsd(cashPortfolio));
    }
    if (nativeToken) {
      return solana
        ? fetchWalletSolanaBalance(session.solana.address)
        : fetchWalletNativeBalance(token.chainKey, session.evm.address);
    }
    if (tokenDecimals === null) return Promise.resolve(0);
    return solana
      ? fetchWalletSplTokenBalance(token.address, tokenDecimals, session.solana.address)
      : fetchWalletTokenBalance(token.chainKey, token.address, tokenDecimals, session.evm.address);
  }, [session, isBuySide, solana, nativeToken, token, tokenDecimals, cashPortfolio]);

  // Bumped by the "Couldn't load balance" retry tap below — useAvailableBalance
  // only refetches when one of its deps changes, and none of the real deps
  // (session/side/token) change on a retry tap, so this is a dedicated one.
  const [balanceRetryToken, setBalanceRetryToken] = useState(0);
  const {balance, loading: balanceLoading} = useAvailableBalance(session ? fetchPayBalance : null, [session, isBuySide, solana, token, tokenDecimals, balanceRetryToken, cashPortfolio]);
  const insufficientBalance = amtNum > 0 && balance !== null && amtNum > balance;
  // Relay's quote API takes one concrete origin chain per call. The
  // aggregate cash balance is presented as one balance, while the planner
  // builds direct source -> destination legs underneath it. Build the
  // unified execution plan whenever the aggregate cash portfolio is
  // available, even if one chain alone can cover the trade, so Relay route
  // quality is compared instead of assuming the largest balance is best.
  const unifiedCashSources = cashPortfolio?.results.filter(r => r.status === 'ok' && spendableCash(r.chainKey, r.balance) > 0).length ?? 0;
// Keep the existing single-quote path when the only spendable cash is
// already on the token's destination chain. That path owns the complete
// same-chain fallback stack (Uniswap/Sushi/Pancake/1inch/0x, plus the
// Solana pump.fun/PumpSwap fallback). The unified planner used to bypass
// that stack and turn a perfectly executable same-chain trade into a
// misleading "$0.00 safe direct route" error.
const needsUnifiedRouting =
  !nearToken &&
  isBuySide &&
  amtNum > 0 &&
  !insufficientBalance &&
  cashPortfolio !== null &&
  !(unifiedCashSources === 1 && payOrigin.chainKey === token.chainKey);
  // A resolved balance of 0 is real (an empty wallet) and looks
  // identical to a null balance in `balance !== null` checks — this
  // specifically catches the OTHER case, where the fetch itself failed
  // (RPC error, unsupported chain, network drop) and silently left the
  // quick-percent row disabled with no explanation. Real device reports
  // of "the percentage buttons don't do anything" trace to exactly this:
  // balance stuck at null with no visible reason and no way to retry.
  const balanceFetchFailed = !balanceLoading && balance === null && session !== null;

  // Tracks which quick-percent preset (if any) the typed amount still
  // matches, same real bug fix already shipped to mobile's DexScreen.tsx
  // and the site's own Swap tab this session: without this, the row's
  // highlighted pill silently goes stale the moment a user hand-edits
  // the amount after tapping one, or flips Buy/Sell (a different
  // balance entirely — the same percentage of it is a different typed
  // number), reading as broken rather than a preset that no longer
  // applies. Built in here from the start rather than shipped without
  // it and patched later, having already paid for that lesson twice.
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null);
  // Real UX fix: a failed balance fetch used to surface as a red error
  // the instant it happened, even for someone who'd only just opened
  // the screen to look at the chart and hadn't asked for a balance yet.
  // True once the user has actually done something that needs it —
  // typed a real amount, picked a quick-percent preset, or already hit
  // retry — never on page load alone.
  const balanceErrorRelevant = amount.length > 0 || selectedPercent !== null || balanceRetryToken > 0;
  // Pure press feedback (not selection) — activeOpacity alone reads too
  // subtly against the pill's already-light background, so onPressIn/Out
  // toggles a real background shade on top of it, same idea requested
  // for this exact row.
  const [pressedPct, setPressedPct] = useState<number | null>(null);

  function handleQuickPct(pct: number) {
    if (balance === null) return;
    setSelectedPercent(pct);
    if (pct === 1) {
      handleMax();
      return;
    }
    setAmount(formatAmountForInput(balance * pct));
  }

  function handleMax() {
    // Buy always spends cash, Sell always spends the searched token —
    // gas is paid separately in the origin chain's native asset either
    // way, so the full balance is always spendable. Arc is the exception
    // on Buy, where gas is the same USDC; fetchPayBalance already
    // returns the spendable total with that reserve taken out. No native-asset MAX
    // path remains reachable now that Buy never pays in native currency
    // (see this file's own header on the USDC-first product decision).
    if (balance === null) return;
    setAmount(formatAmountForInput(balance));
  }

  useEffect(() => {
    setQuoteError(null);
    // A changed amount/side invalidates any in-flight execution result —
    // signing a stale confirmation against a freshly-typed amount would
    // be exactly the mismatch the intent firewall exists to catch.
    setExecuteState('idle');
    setExecuteError(null);
    setExecuteWarnings([]);
    setExecuteTxHashes([]);
    nearQuoteRef.current = null;
    // A new quote request invalidates every previously built execution plan.
    // Without this, a stale multi-source plan could remain tradeable while a
    // newer amount/token quote is still loading.
    multiSourcePlanRef.current = [];
    if (amtNum <= 0) {
      setQuote(null);
      rawQuoteRef.current = null;
      fallbackParamsRef.current = null;
      setQuoteLoading(false);
      return;
    }
    if (!session) {
      setQuote(null);
      rawQuoteRef.current = null;
      fallbackParamsRef.current = null;
      setQuoteLoading(false);
      return;
    }
    const chainKey = token.chainKey;
    if (chainKey === 'near') {
      // NEAR: Intear's routes over every NEAR DEX, each checked by the
      // site's own route checks (nearTrade.ts) — never Relay.
      rawQuoteRef.current = null;
      fallbackParamsRef.current = null;
      const nearAccount = session.near;
      const decimals = tokenDecimals;
      if (!nearAccount || decimals === null) {
        setQuote(null);
        setQuoteLoading(false);
        return;
      }
      setQuoteLoading(true);
      const nearRequestId = ++quoteRequestIdRef.current;
      const nearTimer = setTimeout(async () => {
        let payUnits: bigint;
        try {
          payUnits = parseUnits(amount, isBuySide ? NEAR_USDC_DECIMALS : decimals);
        } catch {
          setQuoteLoading(false);
          return;
        }
        try {
          const q = await quoteNearTrade({side: isBuySide ? 'buy' : 'sell', token: token.address, payUnits, accountId: nearAccount.address, slippageBps: slippageBps != null ? Number(slippageBps) : null});
          const pair = await resolveDexScreenerPair({chainKey: 'near', tokenAddress: token.address}).catch(() => null);
          if (nearRequestId !== quoteRequestIdRef.current) return;
          const tokenPriceUsd = pair?.priceUsd != null && pair.priceUsd > 0 ? pair.priceUsd : null;
          const received = Number(formatUnits(q.receiveUnits, isBuySide ? decimals : NEAR_USDC_DECIMALS));
          // Same measure as the fallback path's: what the route gives
          // against the token's live market price, fee excluded.
          let priceImpactPct: number | null = null;
          if (tokenPriceUsd != null) {
            const swapped = Number(formatUnits(q.route.amountOut, isBuySide ? decimals : NEAR_USDC_DECIMALS));
            const fair = isBuySide ? swapped * tokenPriceUsd : amtNum * tokenPriceUsd;
            const actual = isBuySide ? Number(formatUnits(q.swapIn, NEAR_USDC_DECIMALS)) : swapped;
            if (fair > 0 && actual > 0) priceImpactPct = isBuySide ? ((fair - actual) / actual) * 100 : ((actual - fair) / fair) * 100;
          }
          nearQuoteRef.current = q;
          setQuote({
            totalFeeUsd: Number(formatUnits(q.fee, NEAR_USDC_DECIMALS)),
            etaSeconds: 10,
            receivedAmountFormatted: formatUnits(q.receiveUnits, isBuySide ? decimals : NEAR_USDC_DECIMALS),
            payAmountUsd: isBuySide ? amtNum : tokenPriceUsd != null ? amtNum * tokenPriceUsd : null,
            receiveAmountUsd: isBuySide ? (tokenPriceUsd != null ? received * tokenPriceUsd : null) : received,
            priceImpactPct,
          });
          setQuoteLoading(false);
        } catch (err) {
          if (nearRequestId !== quoteRequestIdRef.current) return;
          nearQuoteRef.current = null;
          setQuote(null);
          setQuoteLoading(false);
          setQuoteError(err instanceof Error ? err.message : 'Could not get a quote — try again.');
        }
      }, QUOTE_DEBOUNCE_MS);
      return () => clearTimeout(nearTimer);
    }
    // Buy always spends cash on whichever chain payOrigin auto-picked
    // (decimals known statically, chainData.ts's own per-chain overrides
    // included); Sell spends the searched token (decimals only known
    // once the live lookup above resolves) — either way, this is the
    // "You pay" side's decimals.
    const payDecimals = isBuySide ? assetDecimalsForChain(payOrigin.chainKey, CASH_ASSET_BY_CHAIN[payOrigin.chainKey] ?? 'USDC') : tokenDecimals;
    if (payDecimals === undefined || payDecimals === null) {
      setQuote(null);
      rawQuoteRef.current = null;
      fallbackParamsRef.current = null;
      setQuoteLoading(false);
      return;
    }

    setQuoteLoading(true);
    const requestId = ++quoteRequestIdRef.current;
    const timer = setTimeout(() => {
      let amountBaseUnits: string;
      try {
        amountBaseUnits = parseUnits(amount, payDecimals).toString();
      } catch {
        setQuoteLoading(false);
        return;
      }
      // Origin (who signs, which chain the pay side actually spends on)
      // and destination (where the token itself lives) are independent
      // now — a cross-chain buy pays from payOrigin's own chain but
      // still receives on the token's own chain, so the signer address
      // and the recipient address can genuinely be different address
      // TYPES (an EVM address paying in, a Solana address receiving, or
      // vice versa). Both getRelayQuote and the intent firewall already
      // take these as independent params — this was the one piece of
      // wiring that hard-assumed they were always the same chain.
      const userAddress = originIsSolana ? session.solana.address : session.evm.address;
      const recipientAddress = solana ? session.solana.address : session.evm.address;
      const nativeCurrency = currencyAddress(chainKey, NATIVE_SYMBOL[chainKey]);
      // Sell's own receive-asset choice — cash (USDC, or USDG on
      // Robinhood) when the user picked it (and this chain actually has
      // a verified cash address; see receiveAsset's own declaration for
      // why the default already guarantees that), native otherwise.
      // Always the token's own chain — see receiveAsset's own comment
      // for why this never bridges chains the way a cross-chain Buy's
      // payOrigin can.
      const sellReceiveCurrency = receiveAsset === 'cash' ? currencyAddress(chainKey, CASH_ASSET_BY_CHAIN[chainKey] ?? 'USDC') : nativeCurrency;
      const originCurrency = isBuySide ? currencyAddress(payOrigin.chainKey, CASH_ASSET_BY_CHAIN[payOrigin.chainKey] ?? 'USDC') : token.address;
      if (isBuySide && needsUnifiedRouting && cashPortfolio) {
        const contributors = CASH_SUPPORTED_CHAINS
          .map(sourceChainKey => {
            const result = cashPortfolio.results.find(r => r.chainKey === sourceChainKey);
            return {chainKey: sourceChainKey, balance: result?.status === 'ok' ? spendableCash(sourceChainKey, result.balance) : 0};
          })
          .filter(item => item.balance > 0)
          .sort((a, b) => a.chainKey === payOrigin.chainKey ? -1 : b.chainKey === payOrigin.chainKey ? 1 : b.balance - a.balance);

        const buildPlan = async (): Promise<MultiSourceLeg[]> => {
          let remainingUsd = amtNum;
          const remainingContributors = contributors.slice();
          const plan: MultiSourceLeg[] = [];

          type Candidate = {
            contributor: typeof contributors[number];
            legUsd: number;
            legParams: GetRelayQuoteParams;
            legQuote: RelayQuote;
            impact: number | null;
            outputScore: number;
            totalFeeUsd: number;
          };

          const quoteCandidates = async (candidateContributors: typeof contributors): Promise<Candidate[]> => {
            const results = await Promise.allSettled(
              candidateContributors.map(async contributor => {
                const legUsd = Math.min(remainingUsd, contributor.balance);
                if (legUsd < 0.05) throw new Error('leg too small');

                const fromSymbol = CASH_ASSET_BY_CHAIN[contributor.chainKey] ?? 'USDC';
                const payDecimalsForLeg = assetDecimalsForChain(contributor.chainKey, fromSymbol);
                if (payDecimalsForLeg == null) throw new Error('unknown source decimals');

                const legAmountBaseUnits = parseUnits(
                  legUsd.toFixed(payDecimalsForLeg),
                  payDecimalsForLeg,
                ).toString();
                const legUserAddress = contributor.chainKey === 'solana' ? session.solana.address : session.evm.address;
                const legRecipientAddress = solana ? session.solana.address : session.evm.address;
                const legParams: GetRelayQuoteParams = {
                  fromChainKey: contributor.chainKey,
                  toChainKey: chainKey,
                  originCurrency: currencyAddress(contributor.chainKey, fromSymbol),
                  destinationCurrency: token.address,
                  amountBaseUnits: legAmountBaseUnits,
                  userAddress: legUserAddress,
                  recipientAddress: legRecipientAddress,
                  originAmountUsd: legUsd,
                  slippageTolerance: slippageBps ?? undefined,
                };
                const legQuote = await getRelayQuote(legParams);
                const summary = summarizeQuote(legQuote, tokenDecimals ?? 18);
                const impact = summary.priceImpactPct;
                // Never let an aggregate weighted average hide a toxic
                // individual leg (e.g. $1 at 100% impact + $9 at 2%).
                if (impact != null && Math.abs(impact) > EXTREME_PRICE_IMPACT_PCT) {
                  throw new Error('route price impact too high');
                }

                const outputUsd = summary.receiveAmountUsd;
                let outputScore = 0;
                if (outputUsd != null && Number.isFinite(outputUsd) && outputUsd > 0) {
                  outputScore = outputUsd / legUsd;
                } else if (summary.receivedAmountFormatted) {
                  const rawOut = Number.parseFloat(summary.receivedAmountFormatted);
                  if (Number.isFinite(rawOut) && rawOut > 0) outputScore = rawOut / legUsd;
                }
                if (!(outputScore > 0)) throw new Error('quote returned no output');

                return {
                  contributor,
                  legUsd,
                  legParams,
                  legQuote,
                  impact,
                  outputScore,
                  totalFeeUsd: summary.totalFeeUsd ?? Number.POSITIVE_INFINITY,
                };
              }),
            );

            return results
              .filter((r): r is PromiseFulfilledResult<Candidate> => r.status === 'fulfilled')
              .map(r => r.value)
              .sort((a, b) => {
                // Primary objective: what the user actually receives.
                // Relay's quoted output is the final execution result, so
                // subtracting fees again here would double-count costs.
                if (Math.abs(b.outputScore - a.outputScore) > 1e-9) {
                  return b.outputScore - a.outputScore;
                }
                // Secondary objective: lower explicit quoted fees.
                if (a.totalFeeUsd !== b.totalFeeUsd) {
                  return a.totalFeeUsd - b.totalFeeUsd;
                }
                // Stable final tie-break: lower price impact.
                return Math.abs(a.impact ?? 0) - Math.abs(b.impact ?? 0);
              });
          };

          while (remainingUsd > 0.000001 && remainingContributors.length > 0) {
            // Prefer a single full-size quote whenever one source can cover
            // the remaining buy. Relay's app fee has a per-transaction
            // minimum, so unnecessary splitting can make the user's quote
            // worse even when the split legs individually have good rates.
            const fullCover = remainingContributors.filter(c => c.balance + 0.000001 >= remainingUsd);
            let executable = await quoteCandidates(fullCover.length > 0 ? fullCover : remainingContributors);

            // A full-cover source may have no route (or may be rejected for
            // high impact) while smaller sources together can still execute
            // the buy. Do not let the "one leg is cheaper" optimization turn
            // a valid unified balance into a false no-route error.
            if (executable.length === 0 && fullCover.length > 0 && fullCover.length < remainingContributors.length) {
              executable = await quoteCandidates(remainingContributors);
            }

            if (executable.length === 0) break;

            const best = executable[0];
            plan.push({
              chainKey: best.contributor.chainKey,
              amountUsd: best.legUsd,
              quote: best.legQuote,
              params: best.legParams,
            });
            remainingUsd -= best.legUsd;

            const usedIndex = remainingContributors.findIndex(c => c.chainKey === best.contributor.chainKey);
            if (usedIndex >= 0) remainingContributors.splice(usedIndex, 1);
          }

          if (remainingUsd > 0.01) {
            throw new Error(
              'Only $' + (amtNum - remainingUsd).toFixed(2) +
              ' of this buy has a safe direct route to ' + CHAIN_LABEL[chainKey] +
              '; try a smaller amount or wait for another route.',
            );
          }
          return plan;
        };

        buildPlan().then(plan => {
          if (requestId !== quoteRequestIdRef.current) return;
          multiSourcePlanRef.current = plan;
          rawQuoteRef.current = null;
          lastQuoteParamsRef.current = null;
          fallbackParamsRef.current = null;
          const receiveDecimalsFallback = tokenDecimals ?? 18;
          let totalReceivedBaseUnits = 0n;
          let totalReceiveUsd = 0;
          let totalFeeUsd = 0;
          let maxEtaSeconds = 0;
          let weightedImpact = 0;
          let weightedInput = 0;
          for (const leg of plan) {
            const summary = summarizeQuote(leg.quote, receiveDecimalsFallback);
            try { if (summary.receivedAmountFormatted) totalReceivedBaseUnits += parseUnits(summary.receivedAmountFormatted, receiveDecimalsFallback); } catch {}
            totalReceiveUsd += summary.receiveAmountUsd ?? 0;
            totalFeeUsd += summary.totalFeeUsd ?? 0;
            maxEtaSeconds = Math.max(maxEtaSeconds, summary.etaSeconds ?? 0);
            if (summary.priceImpactPct != null) {
              weightedImpact += Math.abs(summary.priceImpactPct) * leg.amountUsd;
              weightedInput += leg.amountUsd;
            }
          }
          let receivedAmountFormatted: string | null = null;
          try { receivedAmountFormatted = formatUnits(totalReceivedBaseUnits, receiveDecimalsFallback); } catch {}
          setQuote({
            totalFeeUsd,
            etaSeconds: maxEtaSeconds,
            receivedAmountFormatted,
            payAmountUsd: amtNum,
            receiveAmountUsd: totalReceiveUsd > 0 ? totalReceiveUsd : null,
            priceImpactPct: weightedInput > 0 ? weightedImpact / weightedInput : null,
          });
          setQuoteError(null);
          setQuoteLoading(false);
        }).catch(err => {
          if (requestId !== quoteRequestIdRef.current) return;
          multiSourcePlanRef.current = [];
          rawQuoteRef.current = null;
          fallbackParamsRef.current = null;
          setQuote(null);
          setQuoteLoading(false);
          setQuoteError(err instanceof Error ? err.message : 'Could not find direct routes for your combined cash balance.');
        });
        return;
      }

      const quoteParams: GetRelayQuoteParams = {
        fromChainKey: isBuySide ? payOrigin.chainKey : chainKey,
        toChainKey: chainKey,
        originCurrency,
        destinationCurrency: isBuySide ? token.address : sellReceiveCurrency,
        amountBaseUnits,
        userAddress,
        recipientAddress,
        originAmountUsd,
        slippageTolerance: slippageBps ?? undefined,
      };
      multiSourcePlanRef.current = [];
      getRelayQuote(quoteParams)
        .then(q => {
          // Stale-response guard — a slower earlier request landing
          // after a faster later one would otherwise flash outdated numbers.
          if (requestId !== quoteRequestIdRef.current) return;
          rawQuoteRef.current = q;
          lastQuoteParamsRef.current = quoteParams;
          fallbackParamsRef.current = null;
          // Only used if Relay's own response omits currency.decimals on
          // the receiving side (summarizeQuote's own doc comment) — the
          // receiving side is the token on Buy (tokenDecimals, already
          // fetched above) or whichever asset receiveAsset points at on
          // Sell (known statically either way), so this fallback is real
          // either way, not a guess.
          const receiveDecimalsFallback = isBuySide
            ? (tokenDecimals ?? 18)
            : (assetDecimalsForChain(chainKey, receiveAsset === 'cash' ? (CASH_ASSET_BY_CHAIN[chainKey] ?? 'USDC') : NATIVE_SYMBOL[chainKey]) ?? 18);
          setQuote(summarizeQuote(q, receiveDecimalsFallback));
          setQuoteLoading(false);
        })
        .catch(relayErr => {
          if (requestId !== quoteRequestIdRef.current) return;
          const relayErrorMessage = relayErr instanceof Error ? relayErr.message : 'Could not get a quote — try again.';
          // Relay itself has no route for this pair — try a fallback DEX
          // aggregator (fallbackDex.ts) before giving up, same real gap
          // mobile's own DexScreen.tsx closes: a thin/new token Relay's
          // solver network hasn't indexed can still have a real quote
          // through 1inch/0x directly. On Solana this checks pump.fun's
          // bonding curve and PumpSwap's post-graduation pool instead
          // (fallbackDex.ts's own header explains why) — still null, and
          // still falling through to the original error, for an ordinary
          // Solana token with no pump.fun presence at all. NONE of these
          // fallback providers can bridge CHAINS — they're all direct
          // on-chain DEX routers/aggregators, same-chain by construction
          // (paying a different ASSET on the SAME chain, e.g. USDC
          // instead of native, is exactly the ordinary case they already
          // handle just fine — only an actual chain difference breaks
          // that assumption) — so a genuinely cross-chain buy skips this
          // entirely and just shows Relay's own error instead of
          // pretending a same-chain aggregator could ever answer a
          // cross-chain request.
          if (isBuySide && payOrigin.chainKey !== chainKey) {
            rawQuoteRef.current = null;
            fallbackParamsRef.current = null;
            setQuote(null);
            setQuoteLoading(false);
            setQuoteError(relayErrorMessage);
            return;
          }
          const receiveDecimalsFallback = isBuySide
            ? (tokenDecimals ?? 18)
            : (assetDecimalsForChain(chainKey, receiveAsset === 'cash' ? (CASH_ASSET_BY_CHAIN[chainKey] ?? 'USDC') : NATIVE_SYMBOL[chainKey]) ?? 18);
          const fallbackParams: FallbackRouteParams = {
            chainKey,
            sellToken: originCurrency,
            buyToken: isBuySide ? token.address : sellReceiveCurrency,
            sellAmount: amountBaseUnits,
            takerAddress: userAddress,
            originAmountUsd,
            buyDecimals: receiveDecimalsFallback,
            slippageBps: slippageBps ?? undefined,
          };
          checkFallbackRoute(fallbackParams)
            .then(async fallback => {
              if (requestId !== quoteRequestIdRef.current) return;
              if (!fallback) {
                rawQuoteRef.current = null;
                fallbackParamsRef.current = null;
                setQuote(null);
                setQuoteLoading(false);
                setQuoteError(relayErrorMessage);
                return;
              }
              // Real UX gap this closes: on Solana, when the pair isn't
              // even SOL<->token shaped, checkFallbackRoute now says so
              // explicitly instead of returning a bare null indistinguishable
              // from "the fallback tried and found nothing" — surface
              // that instead of Relay's own generic message, which used
              // to read as "nothing exists for this trade" rather than
              // "the one fallback here only covers a narrower case."
              if ('unsupportedReason' in fallback) {
                rawQuoteRef.current = null;
                fallbackParamsRef.current = null;
                setQuote(null);
                setQuoteLoading(false);
                setQuoteError(fallback.unsupportedReason);
                return;
              }
              rawQuoteRef.current = null;
              fallbackParamsRef.current = fallbackParams;
              let receivedAmountFormatted: string | null = null;
              try {
                receivedAmountFormatted = formatUnits(BigInt(fallback.buyAmount), receiveDecimalsFallback);
              } catch {
                receivedAmountFormatted = null;
              }
              // Real gap this closes: Relay's own quote carries a
              // priceImpactPct that extremePriceImpact (below) blocks a
              // trade on above EXTREME_PRICE_IMPACT_PCT — this fallback
              // path always left it null, so that same safety gate never
              // fired here no matter how thin the pool actually was. The
              // TOKEN side of the trade is the same contract regardless
              // of Buy/Sell (token.address/token.chainKey); only which
              // side is "fixed/known" vs. "valued at live market price"
              // swaps — a Buy's fixed side is the USD paid
              // (originAmountUsd), a Sell's fixed side is the exact
              // token amount sold (amtNum). See fetchLiveTokenPriceUsd's
              // own header for why this compares against the token's
              // real live market price rather than attempting separate
              // spot-price math per AMM type.
              let priceImpactPct: number | null = null;
              if (requestId === quoteRequestIdRef.current) {
                const tokenPriceUsd = await fetchLiveTokenPriceUsd({chainKey, tokenAddress: token.address});
                if (tokenPriceUsd != null && requestId === quoteRequestIdRef.current) {
                  if (isBuySide && originAmountUsd && receivedAmountFormatted) {
                    const tokensReceived = Number(receivedAmountFormatted);
                    const fairUsdReceived = tokensReceived * tokenPriceUsd;
                    if (Number.isFinite(fairUsdReceived) && fairUsdReceived > 0) {
                      priceImpactPct = ((fairUsdReceived - originAmountUsd) / originAmountUsd) * 100;
                    }
                  } else if (!isBuySide && amtNum > 0 && receivedAmountFormatted) {
                    const fairUsdSold = amtNum * tokenPriceUsd;
                    const nativePriceUsd = receiveAsset === 'cash' ? 1 : (await fetchWalletPrices().catch(() => ({}) as Record<string, number>))[NATIVE_SYMBOL[chainKey]];
                    const actualUsdReceived = nativePriceUsd ? Number(receivedAmountFormatted) * nativePriceUsd : null;
                    if (Number.isFinite(fairUsdSold) && fairUsdSold > 0 && actualUsdReceived != null && Number.isFinite(actualUsdReceived)) {
                      priceImpactPct = ((actualUsdReceived - fairUsdSold) / fairUsdSold) * 100;
                    }
                  }
                }
              }
              if (requestId !== quoteRequestIdRef.current) return;
              setQuote({totalFeeUsd: null, etaSeconds: null, receivedAmountFormatted, payAmountUsd: null, receiveAmountUsd: null, priceImpactPct});
              setQuoteLoading(false);
            })
            .catch(() => {
              if (requestId !== quoteRequestIdRef.current) return;
              rawQuoteRef.current = null;
              fallbackParamsRef.current = null;
              setQuote(null);
              setQuoteLoading(false);
              setQuoteError(relayErrorMessage);
            });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isBuySide, amount, amtNum, session, token, tokenDecimals, slippageBps, originAmountUsd, payOrigin, originIsSolana, solana, receiveAsset]);

  // Flipping side changes which balance the pay card is even reading
  // (native vs. the searched token) — any preset percentage of the OLD
  // balance no longer means anything against the new one, same reasoning
  // pickChain/pickRecentPair clear it on mobile's own DexScreen.tsx.
  function flipToBuy() {
    setIsBuySide(true);
    setSelectedPercent(null);
  }
  function flipToSell() {
    setIsBuySide(false);
    setSelectedPercent(null);
  }

  /**
   * Real fix for a real, confirmed gap: this screen's own balance was
   * always correctly shown as the wallet's WHOLE cross-chain total
   * (fetchPayBalance above), but execution could only ever pull from
   * payOrigin's single chain — Relay's quote API takes one concrete
   * origin per call. A typed/Max'd amount that only added up by
   * combining chains used to just block here (needsUnifiedRouting's own
   * comment called this "real, separate follow-up engineering" — never
   * actually built). This is that: moves the shortfall from every other
   * chain the wallet holds cash on into payOrigin's chain, largest-
   * holding-first, before the real Buy executes — the exact same
   * fee-free cash-to-cash move ConvertCashSheet.tsx already runs
   * (getRelayQuote + executeRelayQuote, waiveAppFee: true), just driven
   * automatically instead of asking the user to run Convert by hand
   * first (a798862's own manual workaround for this identical gap).
   *
   * Never risks losing funds even on a partial failure: every leg that
   * succeeds already landed in the user's own wallet, just on a
   * different chain than planned. Throws with an honest account of
   * what moved and what's still short the moment any leg fails or the
   * total moved still doesn't cover `neededUsd` — this function's own
   * caller never proceeds to the real Buy on an unverified balance.
   */
  // Multi-source buys route each contributing cash chain directly to the
  // destination token chain; there is no intermediate consolidation step.
  
  async function resolveEntryMarketCap(): Promise<number | null> {
    const supplied = Number(token.marketCapUsd);
    const pair = await resolveDexScreenerPair({chainKey: token.chainKey, tokenAddress: token.address});
    return pair?.marketCapUsd != null && pair.marketCapUsd > 0
      ? pair.marketCapUsd
      : Number.isFinite(supplied) && supplied > 0
        ? supplied
        : null;
  }

  async function handleNearTrade() {
    const nearQuote = nearQuoteRef.current;
    if (!nearQuote || !session?.near) return;
    setExecuteError(null);
    setExecuteWarnings([]);
    setExecuteTxHashes([]);
    setResultModalDismissed(false);
    setExecuteState('signing');
    const fromAddress = session.near.address;
    const tradeIsBuySide = isBuySide;
    const entryMarketCapUsd = tradeIsBuySide ? await resolveEntryMarketCap() : null;
    const receivedAmountFormatted = quote?.receivedAmountFormatted ?? null;
    let hashes: string[] = [];
    try {
      const result = await executeNearTrade(session, nearQuote);
      hashes = result.hashes;
      // NEAR reports a swap the exchange cancelled as a successful
      // transaction — nearTrade.ts reads what really happened.
      if (result.status === 'refunded') throw new Error('The exchange cancelled this swap because the price moved past your slippage. Your funds were returned and no fee was charged.');
      if (result.status === 'failed') throw new Error("This swap didn't go through. Nothing was traded and no fee was charged.");
      const warnings: string[] = [];
      if (result.status === 'partial') warnings.push('Only part of this swap filled — the rest was returned to you, and the fee was charged on the filled part only.');
      if (result.status === 'unknown') warnings.push("NEAR hasn't confirmed the final result yet — check History in a moment.");
      setExecuteWarnings(warnings);
      setExecuteTxHashes(hashes);
      setExecuteState('success');
      setLastTrade({isBuySide, paySymbol, receiveSymbol, payAmount: amount, receivedAmountFormatted, chainKey: 'near'});
      markOwnAction(session.evm.address);
      setBalanceRetryToken(t => t + 1);
      addTxHistoryEntry({
        status: 'success',
        chainKey: 'near',
        chainLabel: tradeChainLabel('near'),
        isBuySide,
        paySymbol,
        receiveSymbol,
        payAmount: amount,
        receivedAmountFormatted: result.status === 'ok' ? receivedAmountFormatted : null,
        hashes,
        fromAddress,
        tokenAddress: token.address,
        tokenImageUrl: token.imageUrl,
        entryMarketCapUsd,
      });
    } catch (err) {
      if (err instanceof NearSendError) hashes = err.sent.map(o => o.hash).filter(Boolean);
      let message = err instanceof Error ? err.message : 'This trade could not be sent.';
      if (err instanceof NearSendError && hashes.length > 0) message = `Partially completed: ${message} (${hashes.length === 1 ? 'one step' : `${hashes.length} steps`} of this trade already landed on NEAR — check History.)`;
      setExecuteTxHashes(hashes);
      setExecuteError(message);
      setExecuteState('error');
      addTxHistoryEntry({
        status: 'error',
        chainKey: 'near',
        chainLabel: tradeChainLabel('near'),
        isBuySide,
        paySymbol,
        receiveSymbol,
        payAmount: amount,
        receivedAmountFormatted: null,
        hashes,
        errorMessage: message,
        fromAddress,
      });
    }
  }

  async function handleTrade() {
    const chainKey = token.chainKey;
    if (chainKey === 'near') return handleNearTrade();
    const multiSourcePlan = multiSourcePlanRef.current;
    let quoteToExecute = rawQuoteRef.current;
    const fallbackParams = fallbackParamsRef.current;
    if ((!quoteToExecute && !fallbackParams && multiSourcePlan.length === 0) || !session) return;
    setExecuteError(null);
    setExecuteWarnings([]);
    setExecuteTxHashes([]);
    setResultModalDismissed(false);
    const fromAddress = solana ? session.solana.address : session.evm.address;
    const tradeIsBuySide = isBuySide;
    const entryMarketCapUsd = tradeIsBuySide ? await resolveEntryMarketCap() : null;
    // Multi-source buys execute each direct source -> destination quote below.
    try {
      let txHashes: string[];
      let warnings: string[];
      let receivedAmountFormatted: string | null;
      if (multiSourcePlan.length > 0) {
        const allHashes: string[] = [];
        const allWarnings: string[] = [];
        try {
          for (const leg of multiSourcePlan) {
            setExecuteState('build');
            const result = await executeRelayQuote(leg.quote, session, step => setExecuteState(step), {
              useGaslessTrading: gaslessTradingEnabled,
              requote: () => getRelayQuote(leg.params),
            });
            allHashes.push(...result.txHashes);
            allWarnings.push(...result.warnings);
            
          }
          txHashes = allHashes;
          warnings = allWarnings;
          // Multi-source execution can complete several independent Relay
          // quotes, so the final receive amount must come from the executed
          // plan, not the stale single-quote React state. All legs target
          // the same token/chain, so their raw output amounts can be summed
          // exactly before formatting.
          const totalReceivedRaw = multiSourcePlan.reduce((sum, leg) => {
            const raw = leg.quote?.details?.currencyOut?.amount;
            return sum + (typeof raw === 'string' && /^\\d+$/.test(raw) ? BigInt(raw) : 0n);
          }, 0n);
          const outputDecimals = multiSourcePlan[0]?.quote?.details?.currencyOut?.currency?.decimals ?? 18;
          receivedAmountFormatted = totalReceivedRaw > 0n
            ? formatUnits(totalReceivedRaw, outputDecimals)
            : null;
        } catch (err) {
          // Preserve hashes from completed legs AND any transactions already
          // broadcast by the current leg before it failed. executeRelayQuote()
          // attaches the latter to the same error object; replacing that list
          // here would silently lose a landed transaction from History.
          const currentLegHashes = getPartialTxHashes(err);
          const mergedHashes = [...new Set([...allHashes, ...currentLegHashes])];
          if (mergedHashes.length > 0 && err && typeof err === 'object') {
            (err as Record<string, unknown>)['mangoPartialTxHashes'] = mergedHashes;
          }
          throw err;
        }
      } else if (quoteToExecute) {
        const quoteParamsForRetry = lastQuoteParamsRef.current;
        const result = await executeRelayQuote(quoteToExecute, session, step => setExecuteState(step), {
          useGaslessTrading: gaslessTradingEnabled,
          requote: quoteParamsForRetry ? () => getRelayQuote(quoteParamsForRetry) : undefined,
        });
        txHashes = result.txHashes;
        warnings = result.warnings;
        receivedAmountFormatted = quote?.receivedAmountFormatted ?? null;
      } else {
        // Fallback path re-quotes fresh (tryFallbackProviders runs its
        // own quoteAllProviders internally) rather than reusing the
        // preview amount — same as the Relay path only ever executes the
        // exact quote it already locked in, never a display value.
        setExecuteState('signing');
        const result = await tryFallbackProviders({...fallbackParams!, session});
        setExecuteState('done');
        txHashes = [result.hash];
        warnings = [];
        try {
          receivedAmountFormatted = formatUnits(BigInt(result.buyAmount), fallbackParams!.buyDecimals ?? 18);
        } catch {
          receivedAmountFormatted = null;
        }
        // Best-effort, fire-and-forget — the trade above already
        // succeeded, so this never affects it either way. Only needed
        // when the winning provider didn't already collect Mango's fee
        // inline (1inch's own Integrator Fee does; 0x doesn't; neither
        // pump.fun nor PumpSwap ever does). Branches on chain since the
        // sweep itself is chain-specific — EVM native balance vs. SOL.
        if (!result.feeCollectedInline) {
          if (chainKey === 'solana') {
            sweepFallbackFeeFromSolanaBalance({
              solanaAddress: session.solana.address,
              session,
              originAmountUsd: fallbackParams!.originAmountUsd,
            }).catch(() => {});
          } else {
            sweepFallbackFeeFromNativeBalance({
              chainKey,
              evmAddress: session.evm.address,
              session,
              originAmountUsd: fallbackParams!.originAmountUsd,
            }).catch(() => {});
          }
        }
      }
      setExecuteWarnings(warnings);
      setExecuteTxHashes(txHashes);
      setExecuteState('success');
      setLastTrade({isBuySide, paySymbol, receiveSymbol, payAmount: amount, receivedAmountFormatted, chainKey: chainKey});
      // A completed Sell converts a token into cash (USDC/native) —
      // exactly the kind of balance increase App.tsx's depositWatcher
      // poll would otherwise mistake for an external deposit. Mark it
      // as our own action regardless of Buy/Sell, same reasoning
      // ProfileScreen's refreshCashPortfolio applies to Convert/Withdraw.
      if (session) markOwnAction(session.evm.address);
      addTxHistoryEntry({
        status: 'success',
        chainKey,
        chainLabel: CHAIN_LABEL[chainKey],
        isBuySide,
        paySymbol,
        receiveSymbol,
        payAmount: amount,
        receivedAmountFormatted,
        hashes: txHashes,
        fromAddress,
        tokenAddress: token.address,
        tokenImageUrl: token.imageUrl,
        entryMarketCapUsd,
      });
    } catch (err) {
      // TransactionIntentError carries its own complete, user-facing
      // explanation (txIntentFirewall.ts's own fail() message) — shown
      // exactly as thrown, not re-wrapped, since re-wrapping it would
      // just be a worse paraphrase of a message already written for
      // this exact screen. Anything else (a raw viem/permissionless
      // error, e.g. a rejected UserOperation) goes through
      // describeTradeError so a multi-hundred-character hex dump never
      // renders straight onto the screen — see tradeErrors.ts's header
      // for the real trade that motivated this.
      let message = err instanceof TransactionIntentError ? err.message : describeTradeError(err).message;
      // Real gap this closes: a multi-step Relay quote (Buy/Sell can
      // both have more than one transaction to sign) that failed on
      // step 2+ used to report only the error — the fact that an
      // earlier step had already landed for real on-chain, with a real
      // hash, was silently discarded. getPartialTxHashes reads back
      // whatever executeRelayQuote already tagged onto this exact error
      // (see that file's own header) without needing to know anything
      // about which step failed.
      const partialTxHashes = getPartialTxHashes(err);
      if (partialTxHashes.length > 0) {
        message = `Partially completed: ${message} (${partialTxHashes.length === 1 ? 'one step' : `${partialTxHashes.length} steps`} of this trade already landed on-chain — check History.)`;
      }
      setExecuteError(message);
      setExecuteState('error');
      addTxHistoryEntry({
        status: 'error',
        chainKey,
        chainLabel: CHAIN_LABEL[chainKey],
        isBuySide,
        paySymbol,
        receiveSymbol,
        payAmount: amount,
        receivedAmountFormatted: null,
        hashes: partialTxHashes,
        errorMessage: message,
        fromAddress,
      });
    }
  }

  const extremePriceImpact = quote?.priceImpactPct != null && Math.abs(quote.priceImpactPct) > EXTREME_PRICE_IMPACT_PCT;
  const canTrade =
    (Boolean(rawQuoteRef.current) || Boolean(fallbackParamsRef.current) || multiSourcePlanRef.current.length > 0 || Boolean(nearQuoteRef.current)) &&
    Boolean(session) &&
    !insufficientBalance &&
    !extremePriceImpact &&
    (executeState === 'idle' || executeState === 'error');
  const isExecuting = executeState !== 'idle' && executeState !== 'error' && executeState !== 'success';

  // Same real bug both DexScreen.tsx's own pillHint and the site's own
  // swapPillHint fix (the site's is a direct, explicitly-commented port
  // of mobile's — same priority order, reused here): a freshly opened
  // trade screen with no amount typed is the single most common state
  // here, and a dimmed pill that does nothing and says nothing reads as
  // broken, not as "you haven't told me how much yet". !session takes
  // top priority, same as both references' own "not connected" check —
  // "Unlock", not "Connect", since this wallet is embedded and local
  // rather than an external one to connect. insufficientBalance is
  // deliberately absent here too, same reasoning DexScreen.tsx's own
  // pillHint comment gives: the dedicated "Insufficient balance" error
  // text below the pay/receive cards already owns that message, so this
  // never duplicates it.
  const pillHint = !session
    ? 'Unlock your wallet to trade'
    : insufficientBalance
      ? null
      : amtNum <= 0
        ? `Enter an amount to ${isBuySide ? `buy ${token.symbol}` : `sell ${token.symbol}`}`
        : quoteLoading
          ? 'Finding the best route…'
          : null;

  // A failed trade's error (or a genuine quote failure) used to render
  // as a plain <Text> at the very bottom of this screen's own
  // (unscrollable — styles.screen has no ScrollView) content, below the
  // fee/price-impact rows. On a real device that content sits behind the
  // bottom tab bar / system gesture nav with no way to scroll to it — a
  // real trade failure was effectively invisible. Surfaced instead as a
  // banner right at the top, above the chart, where it's guaranteed
  // visible without scrolling. Price impact stays in its original row
  // below — not duplicated up here — since its position wasn't the
  // problem; see priceImpactPct's own computation in relayQuote.ts for
  // the separate bug in the NUMBER itself on some tokens.
  // executeError deliberately NOT included here anymore — a completed
  // trade's own failure now shows in TradeResultModal (a real result,
  // same weight as a success, not a pre-flight warning banner).
  const topAlert: {message: string; danger: boolean} | null = quoteError
    ? {message: quoteError, danger: true}
    : extremePriceImpact
      ? {message: `Blocked: ${Math.abs(quote!.priceImpactPct!).toFixed(0)}% price impact — this pool has too little liquidity to trade safely right now.`, danger: true}
      : null;

  return (
    <View style={styles.screen}>
      {topAlert && (
        <View style={[styles.topAlertBanner, topAlert.danger && styles.topAlertBannerDanger]}>
          <Text style={styles.topAlertText}>{topAlert.message}</Text>
        </View>
      )}
      <View style={styles.portfolioRow}>
        <Text style={styles.portfolioLabel}>Portfolio</Text>
        <Text style={styles.portfolioValue}>{cashPortfolio ? `$${formatUsd(cashPortfolio.totalUsd)}` : '—'}</Text>
      </View>

      <View style={styles.chainRow}>
        {onBack && (
          <TouchableOpacity style={styles.backButton} onPress={onBack} hitSlop={8} activeOpacity={0.7}>
            <ChevronLeftIcon color={colors.textPrimary} size={20} />
          </TouchableOpacity>
        )}
        <View style={styles.chainPill}>
          <Text style={styles.chainPillLabel}>Trading on </Text>
          <Text style={styles.chainPillValue}>{tradeChainLabel(token.chainKey)}</Text>
        </View>
        <TouchableOpacity style={styles.iconPill} onPress={onOpenSearch} activeOpacity={0.7}>
          <SearchGlyph color={colors.textSecondary} />
          <Text style={styles.iconPillLabel}>Search</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconSquarePill} onPress={() => setSettingsOpen(true)} activeOpacity={0.7} accessibilityLabel="Trade settings">
          <SettingsGlyph color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* The chart gets the vertical room a Swap/Limit/DCA tab row would
          otherwise have taken — Mango Pro deliberately has no Limit/DCA,
          per the product decision behind this screen. */}
      <TokenChartPanel chainKey={token.chainKey} tokenAddress={token.address} />

      {/* Buy/Sell does double duty, same as DexScreen.tsx's own pill row
          (and the site's own explicitly-commented port of it): the
          INACTIVE side just flips direction; the ACTIVE side IS the
          submit control — no separate button below duplicating its job.
          Gated on canTrade exactly like the flip case always was un-gated
          — tapping the already-active side with nothing to submit yet is
          a no-op, explained by pillHint below, not a dead second button. */}
      <View style={styles.buySellRow}>
        <TouchableOpacity
          onPress={() => (!isBuySide ? flipToBuy() : canTrade && handleTrade())}
          style={[styles.buySellPillBuy, isBuySide && styles.buySellPillBuyActive, isBuySide && !canTrade && styles.buySellPillDisabled]}
          activeOpacity={0.8}>
          {isBuySide && isExecuting ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={[styles.buySellTextBuy, styles.buySellTextOnColor]}>{executeStatusLabel(executeState)}</Text>
            </>
          ) : (
            <>
              <Text style={[styles.buySellArrowBuy, isBuySide && styles.buySellTextOnColor]}>↗</Text>
              <Text style={[styles.buySellTextBuy, isBuySide && styles.buySellTextOnColor]}>Buy</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => (isBuySide ? flipToSell() : canTrade && handleTrade())}
          style={[styles.buySellPillSell, !isBuySide && styles.buySellPillSellActive, !isBuySide && !canTrade && styles.buySellPillDisabled]}
          activeOpacity={0.8}>
          {!isBuySide && isExecuting ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={[styles.buySellTextSell, styles.buySellTextOnColor]}>{executeStatusLabel(executeState)}</Text>
            </>
          ) : (
            <>
              <Text style={[styles.buySellArrowSell, !isBuySide && styles.buySellTextOnColor]}>↘</Text>
              <Text style={[styles.buySellTextSell, !isBuySide && styles.buySellTextOnColor]}>Sell</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {pillHint !== null && <Text style={styles.buySellHint}>{pillHint}</Text>}

      {/* Disabled until the real pay-side balance resolves (fetchPayBalance
          above) — same gating DexScreen.tsx's own quick-percent row uses.
          The Custom chip only lights up once selectedPercent is null AND a
          real amount is present, i.e. the typed amount no longer matches
          any preset — same convention as the mobile/site fix this session
          already shipped for the same row. */}
      <View style={styles.quickPctRow}>
        {QUICK_PCT_OPTIONS.map(pct => (
          <TouchableOpacity
            key={pct}
            style={[
              styles.quickPctPill,
              selectedPercent === pct && styles.quickPctPillActive,
              pressedPct === pct && selectedPercent !== pct && styles.quickPctPillPressed,
            ]}
            onPress={() => {
              // Real bug fix: this row used to disable itself outright
              // whenever balance was null, which also covers a FAILED
              // fetch (balanceFetchFailed), not just a still-loading
              // one — a disabled TouchableOpacity fires no press events
              // at all in RN, so a failed balance read left every pill
              // looking and feeling completely dead, with nothing to
              // even suggest what to do about it. A failed fetch now
              // keeps the row tappable and retries it (same retry the
              // "Couldn't load balance — Retry" text below already
              // offers), so a tap always does something and shows the
              // same pressed shading either way.
              if (balanceFetchFailed) {
                setBalanceRetryToken(t => t + 1);
                return;
              }
              handleQuickPct(pct);
            }}
            onPressIn={() => setPressedPct(pct)}
            onPressOut={() => setPressedPct(null)}
            disabled={balanceLoading}
            activeOpacity={0.7}>
            <Text style={[styles.quickPctText, selectedPercent === pct && styles.quickPctTextActive]}>{pct === 1 ? 'MAX' : `${pct * 100}%`}</Text>
          </TouchableOpacity>
        ))}
        <View style={[styles.quickPctPill, selectedPercent === null && amtNum > 0 && styles.quickPctPillActive]}>
          <Text style={[styles.quickPctText, selectedPercent === null && amtNum > 0 && styles.quickPctTextActive]}>Custom</Text>
        </View>
      </View>

      <View style={styles.payReceiveRow}>
        <View style={[styles.card, styles.payReceiveCard]}>
          <Text style={styles.cardLabel}>You pay</Text>
          {/* Real product decision: Buy always spends this wallet's one
              USDC balance, auto-sourced from wherever it actually holds
              it (payOrigin, still tracked internally for Relay's own
              quote — see this file's header) — no "Pay from" chain
              picker, no per-chain badge, nothing to tap here. The
              searched TOKEN is what's pickable on this screen, via
              onOpenSearch on the You Receive side below, not this card. */}
          <View style={styles.prMainRow}>
            {isBuySide ? (
              <View style={styles.assetSelector}>
                <CashBadge chainKey={payOrigin.chainKey} size={16} />
                <Text style={styles.assetSelectorText}>{paySymbol}</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.assetSelector} onPress={onOpenSearch} activeOpacity={0.7} disabled={!onOpenSearch}>
                <AssetIcon symbol={token.symbol} imageUrl={token.imageUrl} size={16} />
                <Text style={styles.assetSelectorText}>{paySymbol}</Text>
                <Text style={styles.assetSelectorChevron}>⌄</Text>
              </TouchableOpacity>
            )}
            <TextInput
              value={amount}
              onChangeText={text => {
                setAmount(text);
                setSelectedPercent(null);
              }}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              style={[styles.amountInput, styles.prAmountInput]}
            />
          </View>
          {(quote?.payAmountUsd != null || session) && (
            <View style={styles.prMetaRow}>
              <Text style={styles.usdEquivText}>{quote?.payAmountUsd != null ? `≈ $${quote.payAmountUsd.toFixed(2)}` : ''}</Text>
              {session &&
                (balanceFetchFailed ? (
                  // Real UX fix: this used to render the moment the fetch
                  // failed, even before the user had done anything but
                  // open the screen to look at the chart — an alarming
                  // red error for a balance nothing had asked for yet.
                  // Now it only appears once the user actually needs that
                  // number: typed an amount, tapped a quick-percent pill
                  // (including retrying through it, per that row's own
                  // fix above), or already retried once here directly.
                  balanceErrorRelevant && (
                    <TouchableOpacity onPress={() => setBalanceRetryToken(t => t + 1)} hitSlop={6}>
                      <Text style={[styles.balanceTextSmall, styles.balanceRetryText]}>Couldn't load balance — Retry</Text>
                    </TouchableOpacity>
                  )
                ) : (
                  <Text style={styles.balanceTextSmall} numberOfLines={1}>
                    {balanceLoading ? '…' : balance !== null ? `${formatAmountForInput(balance)} avail.` : ''}
                  </Text>
                ))}
            </View>
          )}
          {isBuySide && cashPortfolio && !cashPortfolio.complete && (
            <Text style={styles.balanceTextSmall}>
              Some chain balances couldn’t be verified.
            </Text>
          )}
        </View>
        <View style={[styles.card, styles.payReceiveCard]}>
          <Text style={styles.cardLabel}>You receive</Text>
          <View style={styles.prMainRow}>
            {isBuySide ? (
              <TouchableOpacity style={styles.assetSelector} onPress={onOpenSearch} activeOpacity={0.7} disabled={!onOpenSearch}>
                <AssetIcon symbol={token.symbol} imageUrl={token.imageUrl} size={16} />
                <Text style={styles.assetSelectorText}>{receiveSymbol}</Text>
                <Text style={styles.assetSelectorChevron}>⌄</Text>
              </TouchableOpacity>
            ) : (
              // Sell always delivers proceeds as this wallet's one USDC
              // balance — no "Receive as" toggle. The native-asset branch
              // is the one real, disclosed gap: a chain with no verified
              // cash address at all (receiveAsset's own declaration)
              // still lands as native, honestly, not offered as a choice.
              <View style={styles.assetSelector}>
                {token.chainKey === 'near' ? <CashBadge chainKey={payOrigin.chainKey} size={16} /> : receiveAsset === 'cash' ? <CashBadge chainKey={token.chainKey} size={16} /> : <NetworkIcon chainKey={token.chainKey} size={16} />}
                <Text style={styles.assetSelectorText}>{receiveSymbol}</Text>
              </View>
            )}
            {quoteLoading ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <Text style={[styles.prReceiveAmount, !quote?.receivedAmountFormatted && styles.receiveAmountTextMuted]} numberOfLines={1}>
                {quote?.receivedAmountFormatted ?? '—'}
              </Text>
            )}
          </View>
          {quote?.receiveAmountUsd != null && <Text style={styles.usdEquivTextRight}>≈ ${quote.receiveAmountUsd.toFixed(2)}</Text>}
        </View>
      </View>

      {!isBuySide && tokenDecimalsError && <Text style={styles.errorText}>{tokenDecimalsError}</Text>}
      {!isBuySide && !tokenDecimalsError && tokenDecimals === null && amtNum > 0 && <Text style={styles.noteText}>Verifying this token…</Text>}
      {insufficientBalance && <Text style={styles.errorText}>{nearToken && isBuySide ? 'Not enough USDC on NEAR — move some there with Convert on Profile first.' : `Insufficient ${paySymbol} balance`}</Text>}
      {needsUnifiedRouting && (
        <Text style={styles.noteText}>
          Your ${amtNum.toFixed(2)} buy will be split across available cash chains and routed directly to {CHAIN_LABEL[token.chainKey as ChainKey]} — no manual bridging or chain selection.
        </Text>
      )}
      <View style={styles.feeRow}>
        <View style={styles.feeRowLeft}>
          <View style={styles.feeDot} />
          <Text style={styles.feeText}>{quote?.totalFeeUsd != null ? `Fee $${quote.totalFeeUsd.toFixed(2)}` : `Fee ${formatFeePct(DEV_FEE_PCT)}%`}</Text>
        </View>
        <Text style={styles.etaText}>{quote?.etaSeconds != null ? `ETA: ${formatEta(quote.etaSeconds)}` : 'ETA: ~1 min'}</Text>
      </View>

      {/* Real, Relay-quoted figure (relayQuote.ts's own summarizeQuote) —
          was computed on every quote already but never actually shown
          anywhere on this screen. Same >3% danger threshold Bridge's own
          equivalent row already uses, so "high price impact" means the
          same thing across this app rather than a screen-specific guess. */}
      {quote?.priceImpactPct != null && (
        <View style={styles.priceImpactRow}>
          <Text style={styles.priceImpactLabel}>Price impact</Text>
          <Text style={[styles.priceImpactValue, Math.abs(quote.priceImpactPct) > 3 && styles.priceImpactValueDanger]}>{Math.abs(quote.priceImpactPct).toFixed(2)}%</Text>
        </View>
      )}

      <TradeResultModal
        visible={(executeState === 'success' || executeState === 'error') && !resultModalDismissed}
        isSuccess={executeState === 'success'}
        result={lastTrade}
        hashes={executeTxHashes}
        warnings={executeWarnings}
        errorMessage={executeError}
        onDone={() => {
          setResultModalDismissed(true);
          // A success returns the panel to a fresh, ready-to-trade state
          // (matching mango-mobile's SendScreen "Done" → back to the
          // form) — an error leaves executeState as 'error', which
          // canTrade already treats the same as idle, so "Try again"
          // there needs no extra reset.
          if (executeState === 'success') setExecuteState('idle');
        }}
      />
      <TradeSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} slippageBps={slippageBps} onSave={setSlippageBps} />
    </View>
  );
}

// Called only from the isExecuting branch (executeState is an ExecuteStep
// in practice), but `isExecuting` is a
// plain boolean, so TS can't narrow `executeState`'s own union type at
// that call site — accepts the full ExecuteState shape here instead of
// forcing a cast at every call.
function executeStatusLabel(state: 'idle' | ExecuteStep | 'success' | 'error'): string {
  switch (state) {
    case 'build':
      return 'Preparing…';
    case 'signing':
      return 'Signing…';
    case 'filling':
      return 'Confirming…';
    case 'done':
      return 'Done';
    default:
      return '';
  }
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, padding: 16},
    portfolioRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10},
    portfolioLabel: {color: colors.textMuted, fontSize: 11, fontWeight: '600'},
    portfolioValue: {color: colors.textPrimary, fontSize: 15, fontWeight: '800'},
    chainRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8},
    backButton: {width: 26, height: 26, alignItems: 'center', justifyContent: 'center'},
    chainPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.pillBg,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    chainPillLabel: {color: colors.textMuted, fontSize: 10.5},
    chainPillValue: {color: colors.textPrimary, fontSize: 10.5, fontWeight: '700'},
    iconPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 26,
      borderRadius: 13,
      paddingHorizontal: 10,
      backgroundColor: colors.pillBg,
    },
    iconPillLabel: {color: colors.textSecondary, fontSize: 11, fontWeight: '600'},
    iconSquarePill: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.pillBg,
    },
    card: {
      backgroundColor: colors.panel,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderRadius: 14,
      padding: 14,
    },
    cardLabel: {color: colors.textMuted, fontSize: 10, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6},
    payReceiveRow: {flexDirection: 'row', gap: 8, marginTop: 12},
    payReceiveCard: {flex: 1, padding: 12},
    prMainRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6},
    prMetaRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, gap: 6},
    balanceTextSmall: {color: colors.textMuted, fontSize: 10, flexShrink: 1},
    balanceRetryText: {color: colors.danger, fontWeight: '600', textDecorationLine: 'underline'},
    amountInput: {flex: 1, fontSize: 16, fontWeight: '600', color: colors.textPrimary},
    prAmountInput: {textAlign: 'right'},
    prReceiveAmount: {flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '600', textAlign: 'right'},
    receiveAmountTextMuted: {color: colors.textMuted},
    usdEquivText: {color: colors.textMuted, fontSize: 10, fontWeight: '600'},
    usdEquivTextRight: {color: colors.textMuted, fontSize: 10, fontWeight: '600', textAlign: 'right', marginTop: 4},
    quickPctRow: {flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 2},
    quickPctPill: {flex: 1, alignItems: 'center', backgroundColor: colors.pillBg, borderRadius: 999, paddingVertical: 7},
    quickPctPillActive: {backgroundColor: colors.ctaBg},
    quickPctPillPressed: {backgroundColor: colors.input},
    quickPctText: {color: colors.textSecondary, fontSize: 11, fontWeight: '600'},
    quickPctTextActive: {color: colors.ctaText},
    assetSelector: {flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.pillBg, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3},
    assetSelectorText: {color: colors.textPrimary, fontSize: 11, fontWeight: '700'},
    assetSelectorChevron: {color: colors.textMuted, fontSize: 11, fontWeight: '700'},
    buySellRow: {flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 2},
    buySellPillBuy: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingVertical: 11,
      borderRadius: 999,
      borderWidth: 1,
      backgroundColor: colors.panel,
      borderColor: colors.gain,
    },
    buySellPillBuyActive: {backgroundColor: colors.gain, borderColor: colors.gain},
    buySellPillSell: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingVertical: 11,
      borderRadius: 999,
      borderWidth: 1,
      backgroundColor: colors.panel,
      borderColor: colors.danger,
    },
    buySellPillSellActive: {backgroundColor: colors.danger, borderColor: colors.danger},
    buySellPillDisabled: {opacity: 0.4},
    buySellArrowBuy: {fontSize: 14, fontWeight: '800', color: colors.gain},
    buySellArrowSell: {fontSize: 14, fontWeight: '800', color: colors.danger},
    buySellTextBuy: {fontSize: 13.5, fontWeight: '700', color: colors.gain},
    buySellTextSell: {fontSize: 13.5, fontWeight: '700', color: colors.danger},
    buySellTextOnColor: {color: '#fff'},
    buySellHint: {color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: -4, marginBottom: 6},
    noteText: {color: colors.textMuted, fontSize: 11, marginTop: 6, textAlign: 'center'},
    errorText: {color: colors.danger, fontSize: 11, marginTop: 6, textAlign: 'center'},
    topAlertBanner: {
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginBottom: 8,
    },
    topAlertBannerDanger: {backgroundColor: `${colors.danger}1a`, borderColor: colors.danger},
    topAlertText: {color: colors.danger, fontSize: 12, fontWeight: '600', textAlign: 'center'},
    feeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: colors.panel,
      borderColor: colors.panelBorder,
      borderWidth: 1,
    },
    feeRowLeft: {flexDirection: 'row', alignItems: 'center', gap: 6},
    feeDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent},
    feeText: {color: colors.accentDeep, fontSize: 11, fontWeight: '500'},
    etaText: {color: colors.textSecondary, fontSize: 11},
    priceImpactRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingHorizontal: 4},
    priceImpactLabel: {color: colors.textMuted, fontSize: 11},
    priceImpactValue: {color: colors.textSecondary, fontSize: 11, fontWeight: '600'},
    priceImpactValueDanger: {color: colors.danger, fontWeight: '700'},
  });
}
