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
// - Balances are real too: the pay side's native or on-chain token
//   balance (fetchWalletNativeBalance/fetchWalletTokenBalance/Solana
//   equivalents in walletRpc.ts) drives the 25/50/75/MAX quick-percent
//   row, Max on a native pay side reserves a live gas estimate, and an
//   amount over the real balance blocks the trade with a clear message
//   instead of failing on-chain.
// - Execution is real on both sides: tapping Buy/Sell runs the quote
//   through src/core/txIntentFirewall.ts (via executeRelayQuote.ts)
//   before signing anything, then signs and broadcasts directly with
//   the session's own key — same non-custodial, direct-broadcast model
//   as every other send in this app.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Image, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {formatUnits, parseUnits} from 'viem';
import {TokenChartPanel} from '../components/TokenChartPanel';
import {ChevronLeftIcon} from '../components/icons';
import {NetworkIcon} from '../wallet/NetworkIcon';
import {CHAIN_LABEL, NATIVE_SYMBOL, assetDecimalsForChain, currencyAddress, type ChainKey} from '../core/chainData';
import {DEV_FEE_PCT} from '../core/fees';
import {getRelayQuote, summarizeQuote, type QuoteSummary, type RelayQuote} from '../core/relayQuote';
import {executeRelayQuote, type ExecuteStep} from '../core/executeRelayQuote';
import {checkFallbackRoute, sweepFallbackFeeFromNativeBalance, tryFallbackProviders, type FallbackRouteParams} from '../core/fallbackDex';
import {fetchWalletPrices} from '../core/walletPrices';
import {TransactionIntentError} from '../core/txIntentFirewall';
import {
  estimateEvmNativeFeeReserve,
  estimateSolanaMaxReserveSol,
  fetchErc20TokenMetadata,
  fetchSplMintDecimals,
  fetchWalletNativeBalance,
  fetchWalletSolanaBalance,
  fetchWalletSplTokenBalance,
  fetchWalletTokenBalance,
} from '../wallet/walletRpc';
import {computeMaxAmount, formatAmountForInput, useAvailableBalance} from '../wallet/useAvailableBalance';
import {addTxHistoryEntry} from '../wallet/txHistory';
import {useSession} from '../wallet/SessionContext';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {TradeSettingsSheet} from '../components/TradeSettingsSheet';
import {cashLogoUrl, fetchCashPortfolio, CASH_ASSET_BY_CHAIN, CASH_SUPPORTED_CHAINS, type CashPortfolio} from '../core/usdcBalances';

/**
 * Buy-side only — what chain/asset "You pay" actually spends from. Sell
 * has no equivalent: you can only sell a token from the chain it's
 * actually held on, there's no "origin" to pick. Defaults to the
 * token's own chain's native asset (today's only option before this),
 * so nothing changes until a user actively picks something else.
 *
 * 'cash' means whichever real asset CASH_ASSET_BY_CHAIN names for that
 * chain — USDC almost everywhere, USDG on Robinhood Chain. Without
 * this, a wallet whose only funds are USDG on Robinhood had no way to
 * spend them on a token living on any OTHER chain — the exact "stuck
 * cash" gap Total Cash/Deposit/Withdraw already closed for viewing and
 * moving that balance, just not yet for trading with it.
 */
type PayOrigin = {chainKey: ChainKey; asset: 'native' | 'cash'};

export type DemoToken = {
  chainKey: ChainKey;
  address: string;
  symbol: string;
  /** Real token image from wherever this token was picked (HomeScreen's DiscoveryToken / SearchScreen's TokenSearchResult both already carry one) — optional because the default demo token and any other bare construction site has none; AssetIcon below falls back to a lettered badge rather than fabricating one. */
  imageUrl?: string | null;
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
 * The actual asset's own logo where one is real (a searched/discovered
 * token's imageUrl, already fetched by HomeScreen/SearchScreen — never
 * refetched here), falling back to a lettered badge rather than a wrong
 * or fabricated icon when there isn't one (a bare DemoToken, or an image
 * URL that 404s). Used for the traded token itself — the chain-native
 * pay/receive side uses NetworkIcon directly instead, since that one has
 * a real per-chain icon already ported (src/wallet/NetworkIcon.tsx).
 */
function AssetIcon({symbol, imageUrl, size = 16}: {symbol: string; imageUrl?: string | null; size?: number}) {
  const {colors} = useTheme();
  const [failed, setFailed] = useState(false);
  const s = StyleSheet.create({
    circle: {width: size, height: size, borderRadius: size / 2, backgroundColor: colors.pillBg, alignItems: 'center', justifyContent: 'center'},
    letter: {fontSize: size * 0.55, fontWeight: '700', color: colors.textPrimary},
    image: {width: size, height: size, borderRadius: size / 2},
  });
  if (imageUrl && !failed) {
    return <Image source={{uri: imageUrl}} style={s.image} onError={() => setFailed(true)} />;
  }
  return (
    <View style={s.circle}>
      <Text style={s.letter}>{symbol.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
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

  // true = Buy (paying the chain's native asset, receiving the token);
  // false = Sell (paying the token, receiving native) — same isNativeAsset
  // convention DexScreen.tsx already uses for which side is "from".
  const [isBuySide, setIsBuySide] = useState(true);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<QuoteSummary | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteRequestIdRef = useRef(0);
  // The raw quote object, kept alongside its summary — executeRelayQuote
  // needs the actual RelayQuote (steps + the intent relayQuote.ts tagged
  // it with), not the display-only numbers summarizeQuote() derives.
  const rawQuoteRef = useRef<RelayQuote | null>(null);
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

  // null = Auto, Relay's own front-running-aware default (no
  // slippageTolerance sent at all — see relayQuote.ts's own header).
  // Edited only inside TradeSettingsSheet; this is the single source of
  // truth passed straight into getRelayQuote() below.
  const [slippageBps, setSlippageBps] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Cross-chain buy: pay from any chain/asset this wallet actually
  // holds, receive the token on its own chain — Relay itself already
  // handles origin != destination chains fine (relayQuote.ts/
  // executeRelayQuote.ts both take them as independent params); this
  // was the one piece of plumbing missing. Resets to the token's own
  // chain's native asset — today's only option before this — whenever
  // the token changes, so switching tokens never silently carries over
  // a payment origin that doesn't make sense for the new one.
  const [payOrigin, setPayOrigin] = useState<PayOrigin>({chainKey: token.chainKey, asset: 'native'});
  const [showPayOriginPicker, setShowPayOriginPicker] = useState(false);
  // True once the user has actually picked a "Pay from" option themselves
  // — the auto-default effect below never overrides a deliberate choice,
  // only ever fills in a sane default before one exists. Only reset on a
  // TOKEN change (not every time cashPortfolio below happens to update),
  // so a deliberate pick survives a background balance refresh.
  const manualPayOriginRef = useRef(false);
  useEffect(() => {
    manualPayOriginRef.current = false;
  }, [token]);
  const crossChainPay = isBuySide && (payOrigin.chainKey !== token.chainKey || payOrigin.asset !== 'native');

  // Sell-side counterpart to payOrigin: what a sell's proceeds land as.
  // Real gap this closes — Buy already defaults to spending cash
  // wherever this wallet holds it (the effect above), but Sell always
  // converted to the chain's native asset with no way to choose
  // otherwise, so a sale's proceeds never actually joined the "one cash
  // balance across chains" this app's own Profile screen is built
  // around. Defaults to cash when the token's own chain actually has a
  // verified cash address (CASH_SUPPORTED_CHAINS) — same honesty rule
  // as everywhere else this app checks that list — and to native
  // otherwise (no fabricated option on a chain with no real cash asset).
  // Always same-chain (token.chainKey): unlike a cross-chain Buy, there
  // is no reason to receive a sale's proceeds on a DIFFERENT chain than
  // the token was sold on. 'cash' resolves to CASH_ASSET_BY_CHAIN's real
  // asset for that chain (USDC almost everywhere, USDG on Robinhood) —
  // selling a Robinhood-chain token can land its proceeds as real USDG
  // now, the same way selling anywhere else already lands USDC.
  const [receiveAsset, setReceiveAsset] = useState<'native' | 'cash'>(CASH_SUPPORTED_CHAINS.includes(token.chainKey) ? 'cash' : 'native');
  const [showReceiveAssetPicker, setShowReceiveAssetPicker] = useState(false);
  useEffect(() => {
    setReceiveAsset(CASH_SUPPORTED_CHAINS.includes(token.chainKey) ? 'cash' : 'native');
  }, [token]);

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

  // Real fix: default "Pay from" to wherever this wallet actually holds
  // cash (USDC or, on Robinhood, USDG), not always the token's own
  // chain's native asset — which a fresh or lightly-funded wallet often
  // holds none of, landing the Buy flow on a real "0 avail." balance by
  // default. cashPortfolio is the same real, already-fetched aggregator
  // the picker below already uses; this just applies its answer as the
  // starting pick instead of requiring the user to open the picker and
  // choose it manually every time. Never overrides a manual pick, and a
  // wallet with no cash anywhere simply gets the token's own chain's
  // native asset, which is still the more honest choice than
  // auto-selecting an empty chain.
  //
  // Keyed on [token, cashPortfolio] — not cashPortfolio alone. Real bug
  // this fixes, live-confirmed across three separate tokens/chains
  // (Ethereum, Solana, Robinhood): cashPortfolio is fetched once per
  // session and rarely changes again, so a `[cashPortfolio]`-only effect
  // only ever ran ONCE, the first time a real cash balance appeared.
  // Every token switch after that needed its OWN re-run (a Buy's payable
  // chain is per-token state) but got none, since nothing in
  // cashPortfolio itself had changed — leaving payOrigin silently stuck
  // on whatever it was for the previous token: native SOL/ETH with "0
  // avail." or a failed balance fetch, even though this exact same
  // wallet had a real, already-fetched USDC/USDG balance sitting right
  // there in cashPortfolio the whole time.
  useEffect(() => {
    if (manualPayOriginRef.current) return;
    let best: {chainKey: ChainKey; balance: number} | null = null;
    for (const result of cashPortfolio?.results ?? []) {
      if (result.status !== 'ok' || result.balance <= 0) continue;
      if (!best || result.balance > best.balance) best = {chainKey: result.chainKey, balance: result.balance};
    }
    setPayOrigin(best ? {chainKey: best.chainKey, asset: 'cash'} : {chainKey: token.chainKey, asset: 'native'});
  }, [token, cashPortfolio]);

  // paySymbol reflects payOrigin's own choice on Buy (the token's own
  // chain and native asset on Sell — unchanged, no origin to pick there).
  // CASH_ASSET_BY_CHAIN[payOrigin.chainKey] is only ever undefined for a
  // chainKey the cash picker below never offers, so the 'USDC' fallback
  // here is purely a type-narrowing safety net, not a real guess.
  const paySymbol = isBuySide ? (payOrigin.asset === 'native' ? NATIVE_SYMBOL[payOrigin.chainKey] : (CASH_ASSET_BY_CHAIN[payOrigin.chainKey] ?? 'USDC')) : token.symbol;
  const receiveSymbol = isBuySide ? token.symbol : receiveAsset === 'cash' ? (CASH_ASSET_BY_CHAIN[token.chainKey] ?? 'USDC') : NATIVE_SYMBOL[token.chainKey];
  const amtNum = Number(amount) || 0;

  // Real USD value of what's actually being paid on Buy — cash (USDC or
  // USDG, both real 1:1 pegs) is trivially 1:1 (a real stablecoin peg,
  // not an approximation); the
  // native asset needs a live price lookup, scoped to whichever chain
  // payOrigin actually points at now, not always the token's own chain.
  // The searched token itself has no reliable price source on Sell
  // (walletPrices.ts only covers a small, conservative set of
  // established assets), so this stays undefined there, same "nothing
  // to cap without a real number" rule appFeeBps's own doc comment
  // states. Feeds getRelayQuote's own originAmountUsd below (activating
  // the large-trade fee cap that was otherwise dormant with nothing to
  // compute it against) and the fallback-DEX path's fee cap/sweep.
  const [nativeUsdPrice, setNativeUsdPrice] = useState<number | null>(null);
  useEffect(() => {
    if (!(isBuySide && payOrigin.asset === 'native')) {
      setNativeUsdPrice(null);
      return;
    }
    const nativeSymbol = NATIVE_SYMBOL[payOrigin.chainKey];
    let cancelled = false;
    fetchWalletPrices('usd')
      .then(prices => {
        if (!cancelled) setNativeUsdPrice(prices?.[nativeSymbol] ?? null);
      })
      .catch(() => {
        if (!cancelled) setNativeUsdPrice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isBuySide, payOrigin]);
  const originAmountUsd = !isBuySide ? undefined : payOrigin.asset === 'cash' ? amtNum : nativeUsdPrice != null ? amtNum * nativeUsdPrice : undefined;

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
    const lookup = token.chainKey === 'solana' ? fetchSplMintDecimals(token.address) : fetchErc20TokenMetadata(token.chainKey, token.address).then(meta => meta.decimals);
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
  }, [token]);

  const solana = token.chainKey === 'solana';
  // Which chain the PAY side's balance actually needs to be read from —
  // payOrigin's own choice on Buy, always the token's own chain on Sell
  // (reduces to `solana` there, same value as before this feature).
  const originIsSolana = isBuySide ? payOrigin.chainKey === 'solana' : solana;

  // The real "how much can I spend" answer the quick-percent row below
  // needs — payOrigin's own chain/asset for Buy (USDC reuses the
  // portfolio this screen already fetches below, no extra RPC call; the
  // picker itself only offers a chain once that fetch has resolved, so
  // this never races an unresolved portfolio), the searched token itself
  // for Sell (tokenDecimals, resolved above; unresolved yet just means
  // no balance to report, same reasoning the quote effect below already
  // applies).
  const fetchPayBalance = useCallback((): Promise<number> => {
    if (!session) return Promise.resolve(0);
    if (isBuySide) {
      if (payOrigin.asset === 'cash') {
        const result = cashPortfolio?.results.find(r => r.chainKey === payOrigin.chainKey);
        return Promise.resolve(result?.status === 'ok' ? result.balance : 0);
      }
      return originIsSolana ? fetchWalletSolanaBalance(session.solana.address) : fetchWalletNativeBalance(payOrigin.chainKey, session.evm.address);
    }
    if (tokenDecimals === null) return Promise.resolve(0);
    return solana
      ? fetchWalletSplTokenBalance(token.address, tokenDecimals, session.solana.address)
      : fetchWalletTokenBalance(token.chainKey, token.address, tokenDecimals, session.evm.address);
  }, [session, isBuySide, solana, originIsSolana, token, tokenDecimals, payOrigin, cashPortfolio]);

  // Bumped by the "Couldn't load balance" retry tap below — useAvailableBalance
  // only refetches when one of its deps changes, and none of the real deps
  // (session/side/token) change on a retry tap, so this is a dedicated one.
  const [balanceRetryToken, setBalanceRetryToken] = useState(0);
  const {balance, loading: balanceLoading} = useAvailableBalance(session ? fetchPayBalance : null, [session, isBuySide, solana, token, tokenDecimals, balanceRetryToken, payOrigin, cashPortfolio]);
  const insufficientBalance = amtNum > 0 && balance !== null && amtNum > balance;
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
  const [maxLoading, setMaxLoading] = useState(false);

  function handleQuickPct(pct: number) {
    if (balance === null) return;
    setSelectedPercent(pct);
    if (pct === 1) {
      handleMax();
      return;
    }
    setAmount(formatAmountForInput(balance * pct));
  }

  async function handleMax() {
    if (balance === null) return;
    if (!isBuySide || payOrigin.asset === 'cash') {
      // Sell side pays the searched token, or Buy paying cash — either
      // way gas is paid separately in the origin chain's native asset,
      // so the full balance is spendable (same computeMaxAmount branch
      // a non-native asset always takes).
      setAmount(formatAmountForInput(balance));
      return;
    }
    setMaxLoading(true);
    try {
      const feeReserve = originIsSolana ? await estimateSolanaMaxReserveSol() : await estimateEvmNativeFeeReserve(payOrigin.chainKey);
      setAmount(formatAmountForInput(computeMaxAmount({balance, isNativeAsset: true, feeNative: feeReserve})));
    } catch {
      // The live fee estimate itself failed — fall back to the full
      // balance rather than blocking Max entirely. executeRelayQuote's
      // own pre-flight simulate+balance check (sendRelayEvmStep) still
      // catches a genuinely insufficient result with a clear message
      // before anything signs, so this fallback is never the last line
      // of defense.
      setAmount(formatAmountForInput(balance));
    } finally {
      setMaxLoading(false);
    }
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
    // Buy spends whatever payOrigin points at (native or USDC, on
    // whichever chain was picked — decimals known statically either
    // way, chainData.ts's own per-chain overrides included); Sell
    // spends the searched token (decimals only known once the live
    // lookup above resolves) — either way, this is the "You pay" side's
    // decimals.
    const payDecimals = isBuySide
      ? payOrigin.asset === 'native'
        ? assetDecimalsForChain(payOrigin.chainKey, NATIVE_SYMBOL[payOrigin.chainKey])
        : assetDecimalsForChain(payOrigin.chainKey, CASH_ASSET_BY_CHAIN[payOrigin.chainKey] ?? 'USDC')
      : tokenDecimals;
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
      const nativeCurrency = currencyAddress(token.chainKey, NATIVE_SYMBOL[token.chainKey]);
      // Sell's own receive-asset choice — cash (USDC, or USDG on
      // Robinhood) when the user picked it (and this chain actually has
      // a verified cash address; see receiveAsset's own declaration for
      // why the default already guarantees that), native otherwise.
      // Always the token's own chain — see receiveAsset's own comment
      // for why this never bridges chains the way a cross-chain Buy's
      // payOrigin can.
      const sellReceiveCurrency = receiveAsset === 'cash' ? currencyAddress(token.chainKey, CASH_ASSET_BY_CHAIN[token.chainKey] ?? 'USDC') : nativeCurrency;
      const originCurrency = isBuySide
        ? payOrigin.asset === 'native'
          ? currencyAddress(payOrigin.chainKey, NATIVE_SYMBOL[payOrigin.chainKey])
          : currencyAddress(payOrigin.chainKey, CASH_ASSET_BY_CHAIN[payOrigin.chainKey] ?? 'USDC')
        : token.address;
      getRelayQuote({
        fromChainKey: isBuySide ? payOrigin.chainKey : token.chainKey,
        toChainKey: token.chainKey,
        originCurrency,
        destinationCurrency: isBuySide ? token.address : sellReceiveCurrency,
        amountBaseUnits,
        userAddress,
        recipientAddress,
        originAmountUsd,
        slippageTolerance: slippageBps ?? undefined,
      })
        .then(q => {
          // Stale-response guard — a slower earlier request landing
          // after a faster later one would otherwise flash outdated numbers.
          if (requestId !== quoteRequestIdRef.current) return;
          rawQuoteRef.current = q;
          fallbackParamsRef.current = null;
          // Only used if Relay's own response omits currency.decimals on
          // the receiving side (summarizeQuote's own doc comment) — the
          // receiving side is the token on Buy (tokenDecimals, already
          // fetched above) or whichever asset receiveAsset points at on
          // Sell (known statically either way), so this fallback is real
          // either way, not a guess.
          const receiveDecimalsFallback = isBuySide
            ? (tokenDecimals ?? 18)
            : (assetDecimalsForChain(token.chainKey, receiveAsset === 'cash' ? (CASH_ASSET_BY_CHAIN[token.chainKey] ?? 'USDC') : NATIVE_SYMBOL[token.chainKey]) ?? 18);
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
          if (isBuySide && payOrigin.chainKey !== token.chainKey) {
            rawQuoteRef.current = null;
            fallbackParamsRef.current = null;
            setQuote(null);
            setQuoteLoading(false);
            setQuoteError(relayErrorMessage);
            return;
          }
          const receiveDecimalsFallback = isBuySide
            ? (tokenDecimals ?? 18)
            : (assetDecimalsForChain(token.chainKey, receiveAsset === 'cash' ? (CASH_ASSET_BY_CHAIN[token.chainKey] ?? 'USDC') : NATIVE_SYMBOL[token.chainKey]) ?? 18);
          const fallbackParams: FallbackRouteParams = {
            chainKey: token.chainKey,
            sellToken: originCurrency,
            buyToken: isBuySide ? token.address : sellReceiveCurrency,
            sellAmount: amountBaseUnits,
            takerAddress: userAddress,
            originAmountUsd,
            buyDecimals: receiveDecimalsFallback,
          };
          checkFallbackRoute(fallbackParams)
            .then(fallback => {
              if (requestId !== quoteRequestIdRef.current) return;
              if (!fallback) {
                rawQuoteRef.current = null;
                fallbackParamsRef.current = null;
                setQuote(null);
                setQuoteLoading(false);
                setQuoteError(relayErrorMessage);
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
              setQuote({totalFeeUsd: null, etaSeconds: null, receivedAmountFormatted, payAmountUsd: null, receiveAmountUsd: null, priceImpactPct: null});
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

  async function handleTrade() {
    const quoteToExecute = rawQuoteRef.current;
    const fallbackParams = fallbackParamsRef.current;
    if ((!quoteToExecute && !fallbackParams) || !session) return;
    setExecuteError(null);
    setExecuteWarnings([]);
    setExecuteTxHashes([]);
    const fromAddress = solana ? session.solana.address : session.evm.address;
    try {
      let txHashes: string[];
      let warnings: string[];
      let receivedAmountFormatted: string | null;
      if (quoteToExecute) {
        const result = await executeRelayQuote(quoteToExecute, session, step => setExecuteState(step));
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
        // inline (1inch's own Integrator Fee does; 0x doesn't). EVM-only:
        // sweepFallbackFeeFromNativeBalance resolves an EVM chain id
        // internally and would just throw (into the .catch below) for a
        // Solana pump.fun/PumpSwap fallback trade — neither collects a
        // fee inline either, but there's no Solana-native sweep built yet
        // (see fallbackDex.ts's own header), so this is skipped outright
        // rather than calling something guaranteed to fail.
        if (!result.feeCollectedInline && token.chainKey !== 'solana') {
          sweepFallbackFeeFromNativeBalance({
            chainKey: token.chainKey,
            evmAddress: session.evm.address,
            session,
            originAmountUsd: fallbackParams!.originAmountUsd,
          }).catch(() => {});
        }
      }
      setExecuteWarnings(warnings);
      setExecuteTxHashes(txHashes);
      setExecuteState('success');
      addTxHistoryEntry({
        status: 'success',
        chainKey: token.chainKey,
        chainLabel: CHAIN_LABEL[token.chainKey],
        isBuySide,
        paySymbol,
        receiveSymbol,
        payAmount: amount,
        receivedAmountFormatted,
        hashes: txHashes,
        fromAddress,
      });
    } catch (err) {
      // TransactionIntentError carries its own complete, user-facing
      // explanation (txIntentFirewall.ts's own fail() message) — shown
      // exactly as thrown, not re-wrapped, since re-wrapping it would
      // just be a worse paraphrase of a message already written for
      // this exact screen.
      const message = err instanceof TransactionIntentError ? err.message : err instanceof Error ? err.message : 'The trade failed. Nothing left this wallet unless a status above says otherwise.';
      setExecuteError(message);
      setExecuteState('error');
      addTxHistoryEntry({
        status: 'error',
        chainKey: token.chainKey,
        chainLabel: CHAIN_LABEL[token.chainKey],
        isBuySide,
        paySymbol,
        receiveSymbol,
        payAmount: amount,
        receivedAmountFormatted: null,
        hashes: [],
        errorMessage: message,
        fromAddress,
      });
    }
  }

  const canTrade = (Boolean(rawQuoteRef.current) || Boolean(fallbackParamsRef.current)) && Boolean(session) && !insufficientBalance && (executeState === 'idle' || executeState === 'error');
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

  const chainHasCash = CASH_SUPPORTED_CHAINS.includes(token.chainKey);

  return (
    <View style={styles.screen}>
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
          <Text style={styles.chainPillValue}>{CHAIN_LABEL[token.chainKey]}</Text>
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
            disabled={balanceLoading || maxLoading}
            activeOpacity={0.7}>
            <Text style={[styles.quickPctText, selectedPercent === pct && styles.quickPctTextActive]}>{pct === 1 ? (maxLoading ? '…' : 'MAX') : `${pct * 100}%`}</Text>
          </TouchableOpacity>
        ))}
        <View style={[styles.quickPctPill, selectedPercent === null && amtNum > 0 && styles.quickPctPillActive]}>
          <Text style={[styles.quickPctText, selectedPercent === null && amtNum > 0 && styles.quickPctTextActive]}>Custom</Text>
        </View>
      </View>

      <View style={styles.payReceiveRow}>
        <View style={[styles.card, styles.payReceiveCard]}>
          <Text style={styles.cardLabel}>You pay</Text>
          {isBuySide && (
            <TouchableOpacity style={styles.payOriginRow} onPress={() => setShowPayOriginPicker(true)} activeOpacity={0.7}>
              <NetworkIcon chainKey={payOrigin.chainKey} size={13} />
              <Text style={styles.payOriginText} numberOfLines={1}>
                {crossChainPay ? `via ${CHAIN_LABEL[payOrigin.chainKey]}` : 'Pay from'}
              </Text>
              <Text style={styles.payOriginChevron}>⌄</Text>
            </TouchableOpacity>
          )}
          <View style={styles.prMainRow}>
            <TouchableOpacity style={styles.assetSelector} onPress={onOpenSearch} activeOpacity={0.7} disabled={!onOpenSearch}>
              {isBuySide ? (
                payOrigin.asset === 'native' ? (
                  <NetworkIcon chainKey={payOrigin.chainKey} size={16} />
                ) : (
                  <CashBadge chainKey={payOrigin.chainKey} size={16} />
                )
              ) : (
                <AssetIcon symbol={token.symbol} imageUrl={token.imageUrl} size={16} />
              )}
              <Text style={styles.assetSelectorText}>{paySymbol}</Text>
              <Text style={styles.assetSelectorChevron}>⌄</Text>
            </TouchableOpacity>
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
        </View>
        <View style={[styles.card, styles.payReceiveCard]}>
          <Text style={styles.cardLabel}>You receive</Text>
          <View style={styles.prMainRow}>
            <TouchableOpacity
              style={styles.assetSelector}
              onPress={isBuySide ? onOpenSearch : () => setShowReceiveAssetPicker(true)}
              activeOpacity={0.7}
              disabled={isBuySide ? !onOpenSearch : !chainHasCash}>
              {isBuySide ? (
                <AssetIcon symbol={token.symbol} imageUrl={token.imageUrl} size={16} />
              ) : receiveAsset === 'cash' ? (
                <CashBadge chainKey={token.chainKey} size={16} />
              ) : (
                <NetworkIcon chainKey={token.chainKey} size={16} />
              )}
              <Text style={styles.assetSelectorText}>{receiveSymbol}</Text>
              {(isBuySide || chainHasCash) && <Text style={styles.assetSelectorChevron}>⌄</Text>}
            </TouchableOpacity>
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
      {insufficientBalance && <Text style={styles.errorText}>Insufficient {paySymbol} balance</Text>}
      {quoteError && <Text style={styles.errorText}>{quoteError}</Text>}

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

      {executeState === 'success' && (
        <View style={styles.executeResult}>
          <Text style={styles.executeSuccessText}>Trade sent</Text>
          {executeTxHashes.map(hash => (
            <Text key={hash} style={styles.executeHashText} selectable numberOfLines={1} ellipsizeMode="middle">
              {hash}
            </Text>
          ))}
          {executeWarnings.map(warning => (
            <Text key={warning} style={styles.executeWarningText}>
              {warning}
            </Text>
          ))}
        </View>
      )}
      {executeError && <Text style={styles.errorText}>{executeError}</Text>}

      <TradeSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} slippageBps={slippageBps} onSave={setSlippageBps} />

      <Modal visible={showPayOriginPicker} transparent animationType="fade" onRequestClose={() => setShowPayOriginPicker(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeaderRow}>
              <Text style={styles.pickerTitle}>Pay with</Text>
              <TouchableOpacity onPress={() => setShowPayOriginPicker(false)} hitSlop={8}>
                <Text style={styles.pickerClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.pickerRow}
              activeOpacity={0.7}
              onPress={() => {
                manualPayOriginRef.current = true;
                setPayOrigin({chainKey: token.chainKey, asset: 'native'});
                setShowPayOriginPicker(false);
              }}>
              <NetworkIcon chainKey={token.chainKey} size={22} />
              <Text style={styles.pickerRowText}>
                {NATIVE_SYMBOL[token.chainKey]} on {CHAIN_LABEL[token.chainKey]}
              </Text>
              {payOrigin.chainKey === token.chainKey && payOrigin.asset === 'native' && <Text style={styles.pickerCheck}>✓</Text>}
            </TouchableOpacity>

            {/* Real cross-chain pay: same cash balances ProfileScreen's
                own Deposit/Withdraw already fetches (cashPortfolio,
                shared via this screen's own effect above) — pick any
                chain actually holding cash (USDC almost everywhere,
                USDG on Robinhood Chain — its own real stablecoin, not a
                fabricated substitute) and Relay bridges+swaps it to the
                token's own chain as part of the same quote. This is the
                real fix for a wallet whose only funds are USDG on
                Robinhood: before this, that balance couldn't fund a buy
                on any other chain at all, even though Total Cash on
                Profile already counted it as real spendable dollars.
                Rows with nothing to spend stay visible (never hidden —
                same "always show real state" rule this app holds to
                elsewhere) but disabled, since picking one would just
                fail on "insufficient balance" a moment later. */}
            <Text style={styles.pickerSectionLabel}>Cash — pay from any chain you hold it on</Text>
            {!cashPortfolio ? (
              <ActivityIndicator color={colors.textMuted} style={styles.pickerLoading} />
            ) : (
              CASH_SUPPORTED_CHAINS.map(chainKey => {
                const result = cashPortfolio.results.find(r => r.chainKey === chainKey);
                const chainBalance = result?.status === 'ok' ? result.balance : 0;
                const disabled = chainBalance <= 0;
                const selected = payOrigin.chainKey === chainKey && payOrigin.asset === 'cash';
                return (
                  <TouchableOpacity
                    key={chainKey}
                    style={[styles.pickerRow, disabled && styles.pickerRowDisabled]}
                    activeOpacity={0.7}
                    disabled={disabled}
                    onPress={() => {
                      manualPayOriginRef.current = true;
                      setPayOrigin({chainKey, asset: 'cash'});
                      setShowPayOriginPicker(false);
                    }}>
                    <NetworkIcon chainKey={chainKey} size={22} />
                    <Text style={styles.pickerRowText}>
                      {CASH_ASSET_BY_CHAIN[chainKey] ?? 'USDC'} on {CHAIN_LABEL[chainKey]}
                    </Text>
                    <Text style={styles.pickerRowBalance}>${chainBalance.toFixed(2)}</Text>
                    {selected && <Text style={styles.pickerCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showReceiveAssetPicker} transparent animationType="fade" onRequestClose={() => setShowReceiveAssetPicker(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeaderRow}>
              <Text style={styles.pickerTitle}>Receive as</Text>
              <TouchableOpacity onPress={() => setShowReceiveAssetPicker(false)} hitSlop={8}>
                <Text style={styles.pickerClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.pickerRow}
              activeOpacity={0.7}
              onPress={() => {
                setReceiveAsset('native');
                setShowReceiveAssetPicker(false);
              }}>
              <NetworkIcon chainKey={token.chainKey} size={22} />
              <Text style={styles.pickerRowText}>
                {NATIVE_SYMBOL[token.chainKey]} on {CHAIN_LABEL[token.chainKey]}
              </Text>
              {receiveAsset === 'native' && <Text style={styles.pickerCheck}>✓</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickerRow}
              activeOpacity={0.7}
              onPress={() => {
                setReceiveAsset('cash');
                setShowReceiveAssetPicker(false);
              }}>
              <CashBadge chainKey={token.chainKey} size={22} />
              <Text style={styles.pickerRowText}>
                {CASH_ASSET_BY_CHAIN[token.chainKey] ?? 'USDC'} on {CHAIN_LABEL[token.chainKey]}
              </Text>
              {receiveAsset === 'cash' && <Text style={styles.pickerCheck}>✓</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function executeStatusLabel(state: 'build' | 'signing' | 'filling' | 'done'): string {
  switch (state) {
    case 'build':
      return 'Preparing…';
    case 'signing':
      return 'Signing…';
    case 'filling':
      return 'Confirming…';
    case 'done':
      return 'Done';
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
    payOriginRow: {flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8, marginTop: -4},
    payOriginText: {color: colors.textSecondary, fontSize: 10.5, fontWeight: '600', flexShrink: 1},
    payOriginChevron: {color: colors.textMuted, fontSize: 10, fontWeight: '700'},
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

    executeResult: {marginTop: 12, alignItems: 'center', gap: 4, paddingVertical: 10},
    executeSuccessText: {color: colors.gain, fontSize: 15, fontWeight: '700'},
    executeHashText: {color: colors.textMuted, fontSize: 11, fontFamily: 'monospace'},
    executeWarningText: {color: colors.warning, fontSize: 10.5, textAlign: 'center', marginTop: 2},

    pickerBackdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)'},
    pickerCard: {backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '75%'},
    pickerHeaderRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14},
    pickerTitle: {color: colors.textPrimary, fontSize: 18, fontWeight: '800'},
    pickerClose: {color: colors.textMuted, fontSize: 13, fontWeight: '600'},
    pickerSectionLabel: {color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 8},
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.panel,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 8,
    },
    pickerRowDisabled: {opacity: 0.4},
    pickerRowText: {flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700'},
    pickerRowBalance: {color: colors.textMuted, fontSize: 12.5, fontWeight: '600'},
    pickerCheck: {color: colors.navActive, fontSize: 15, fontWeight: '800', marginLeft: 4},
    pickerLoading: {marginVertical: 14},
  });
}
