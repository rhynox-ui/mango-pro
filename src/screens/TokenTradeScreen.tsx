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
import {ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {formatUnits, parseUnits} from 'viem';
import {TokenChartPanel} from '../components/TokenChartPanel';
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
import {fetchUsdcPortfolio, type UsdcPortfolio} from '../core/usdcBalances';

export type DemoToken = {
  chainKey: ChainKey;
  address: string;
  symbol: string;
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
}: {
  token?: DemoToken;
  onOpenSearch?: () => void;
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

  // Same real, live aggregator ProfileScreen's own "Total Cash" already
  // uses — reused here rather than re-derived, so this screen's own
  // portfolio figure can never quietly drift from the one on Profile.
  const [usdcPortfolio, setUsdcPortfolio] = useState<UsdcPortfolio | null>(null);
  useEffect(() => {
    if (!session) {
      setUsdcPortfolio(null);
      return;
    }
    let cancelled = false;
    fetchUsdcPortfolio(session).then(portfolio => {
      if (!cancelled) setUsdcPortfolio(portfolio);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const paySymbol = isBuySide ? NATIVE_SYMBOL[token.chainKey] : token.symbol;
  const receiveSymbol = isBuySide ? token.symbol : NATIVE_SYMBOL[token.chainKey];
  const amtNum = Number(amount) || 0;

  // Real USD value of the native asset being paid on Buy — the searched
  // token itself has no reliable price source on Sell (walletPrices.ts
  // only covers a small, conservative set of established assets), so
  // this stays null there, same "nothing to cap without a real number"
  // rule appFeeBps's own doc comment states. Feeds getRelayQuote's own
  // originAmountUsd below (activating the large-trade fee cap that was
  // otherwise dormant with nothing to compute it against) and the
  // fallback-DEX path's fee cap/sweep.
  const [nativeUsdPrice, setNativeUsdPrice] = useState<number | null>(null);
  useEffect(() => {
    const nativeSymbol = NATIVE_SYMBOL[token.chainKey];
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
  }, [token.chainKey]);
  const originAmountUsd = isBuySide && nativeUsdPrice != null ? amtNum * nativeUsdPrice : undefined;

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

  // The real "how much can I spend" answer the quick-percent row below
  // needs — native for Buy (chainData.ts already knows its decimals
  // statically), the searched token itself for Sell (tokenDecimals,
  // resolved above; unresolved yet just means no balance to report,
  // same reasoning the quote effect below already applies).
  const fetchPayBalance = useCallback((): Promise<number> => {
    if (!session) return Promise.resolve(0);
    if (isBuySide) {
      return solana ? fetchWalletSolanaBalance(session.solana.address) : fetchWalletNativeBalance(token.chainKey, session.evm.address);
    }
    if (tokenDecimals === null) return Promise.resolve(0);
    return solana
      ? fetchWalletSplTokenBalance(token.address, tokenDecimals, session.solana.address)
      : fetchWalletTokenBalance(token.chainKey, token.address, tokenDecimals, session.evm.address);
  }, [session, isBuySide, solana, token, tokenDecimals]);

  const {balance, loading: balanceLoading} = useAvailableBalance(session ? fetchPayBalance : null, [session, isBuySide, solana, token, tokenDecimals]);
  const insufficientBalance = amtNum > 0 && balance !== null && amtNum > balance;

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
    if (!isBuySide) {
      // Sell side pays the searched token — gas is paid separately in
      // the chain's native asset, so the full token balance is spendable
      // (same computeMaxAmount branch a non-native asset always takes).
      setAmount(formatAmountForInput(balance));
      return;
    }
    setMaxLoading(true);
    try {
      const feeReserve = solana ? await estimateSolanaMaxReserveSol() : await estimateEvmNativeFeeReserve(token.chainKey);
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
    // Buy spends native (decimals known statically); Sell spends the
    // searched token (decimals only known once the live lookup above
    // resolves) — either way, this is the "You pay" side's decimals.
    const payDecimals = isBuySide ? assetDecimalsForChain(token.chainKey, NATIVE_SYMBOL[token.chainKey]) : tokenDecimals;
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
      const userAddress = token.chainKey === 'solana' ? session.solana.address : session.evm.address;
      const nativeCurrency = currencyAddress(token.chainKey, NATIVE_SYMBOL[token.chainKey]);
      getRelayQuote({
        fromChainKey: token.chainKey,
        toChainKey: token.chainKey,
        originCurrency: isBuySide ? nativeCurrency : token.address,
        destinationCurrency: isBuySide ? token.address : nativeCurrency,
        amountBaseUnits,
        userAddress,
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
          // fetched above) or the chain's native asset on Sell (known
          // statically), so this fallback is real either way, not a guess.
          const receiveDecimalsFallback = isBuySide ? (tokenDecimals ?? 18) : (assetDecimalsForChain(token.chainKey, NATIVE_SYMBOL[token.chainKey]) ?? 18);
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
          // Solana token with no pump.fun presence at all.
          const receiveDecimalsFallback = isBuySide ? (tokenDecimals ?? 18) : (assetDecimalsForChain(token.chainKey, NATIVE_SYMBOL[token.chainKey]) ?? 18);
          const fallbackParams: FallbackRouteParams = {
            chainKey: token.chainKey,
            sellToken: isBuySide ? nativeCurrency : token.address,
            buyToken: isBuySide ? token.address : nativeCurrency,
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
  }, [isBuySide, amount, amtNum, session, token, tokenDecimals, slippageBps, originAmountUsd]);

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

  return (
    <View style={styles.screen}>
      <View style={styles.portfolioRow}>
        <Text style={styles.portfolioLabel}>Portfolio</Text>
        <Text style={styles.portfolioValue}>{usdcPortfolio ? `$${formatUsd(usdcPortfolio.totalUsd)}` : '—'}</Text>
      </View>

      <View style={styles.chainRow}>
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
            style={[styles.quickPctPill, selectedPercent === pct && styles.quickPctPillActive]}
            onPress={() => handleQuickPct(pct)}
            disabled={balance === null || maxLoading}
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
          <View style={styles.prMainRow}>
            <TouchableOpacity style={styles.assetSelector} onPress={onOpenSearch} activeOpacity={0.7} disabled={!onOpenSearch}>
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
              {session && (
                <Text style={styles.balanceTextSmall} numberOfLines={1}>
                  {balanceLoading ? '…' : balance !== null ? `${formatAmountForInput(balance)} avail.` : ''}
                </Text>
              )}
            </View>
          )}
        </View>
        <View style={[styles.card, styles.payReceiveCard]}>
          <Text style={styles.cardLabel}>You receive</Text>
          <View style={styles.prMainRow}>
            <TouchableOpacity style={styles.assetSelector} onPress={onOpenSearch} activeOpacity={0.7} disabled={!onOpenSearch}>
              <Text style={styles.assetSelectorText}>{receiveSymbol}</Text>
              <Text style={styles.assetSelectorChevron}>⌄</Text>
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
    amountInput: {flex: 1, fontSize: 16, fontWeight: '600', color: colors.textPrimary},
    prAmountInput: {textAlign: 'right'},
    prReceiveAmount: {flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '600', textAlign: 'right'},
    receiveAmountTextMuted: {color: colors.textMuted},
    usdEquivText: {color: colors.textMuted, fontSize: 10, fontWeight: '600'},
    usdEquivTextRight: {color: colors.textMuted, fontSize: 10, fontWeight: '600', textAlign: 'right', marginTop: 4},
    quickPctRow: {flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 2},
    quickPctPill: {flex: 1, alignItems: 'center', backgroundColor: colors.pillBg, borderRadius: 999, paddingVertical: 7},
    quickPctPillActive: {backgroundColor: colors.ctaBg},
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
  });
}
