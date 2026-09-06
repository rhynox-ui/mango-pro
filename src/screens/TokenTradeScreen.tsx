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
// - Balances are still null (no balance-fetching wired yet), so the
//   percent-quick-fill row stays correctly disabled.
// - Execution is real on both sides: tapping Buy/Sell runs the quote
//   through src/core/txIntentFirewall.ts (via executeRelayQuote.ts)
//   before signing anything, then signs and broadcasts directly with
//   the session's own key — same non-custodial, direct-broadcast model
//   as every other send in this app.

import {useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {parseUnits} from 'viem';
import {TokenChartPanel} from '../components/TokenChartPanel';
import {CHAIN_LABEL, NATIVE_SYMBOL, assetDecimalsForChain, currencyAddress, type ChainKey} from '../core/chainData';
import {DEV_FEE_PCT} from '../core/fees';
import {getRelayQuote, summarizeQuote, type QuoteSummary, type RelayQuote} from '../core/relayQuote';
import {executeRelayQuote, type ExecuteStep} from '../core/executeRelayQuote';
import {TransactionIntentError} from '../core/txIntentFirewall';
import {fetchErc20TokenMetadata, fetchSplMintDecimals} from '../wallet/walletRpc';
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
      setQuoteLoading(false);
      return;
    }
    if (!session) {
      setQuote(null);
      rawQuoteRef.current = null;
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
        slippageTolerance: slippageBps ?? undefined,
      })
        .then(q => {
          // Stale-response guard — a slower earlier request landing
          // after a faster later one would otherwise flash outdated numbers.
          if (requestId !== quoteRequestIdRef.current) return;
          rawQuoteRef.current = q;
          // Only used if Relay's own response omits currency.decimals on
          // the receiving side (summarizeQuote's own doc comment) — the
          // receiving side is the token on Buy (tokenDecimals, already
          // fetched above) or the chain's native asset on Sell (known
          // statically), so this fallback is real either way, not a guess.
          const receiveDecimalsFallback = isBuySide ? (tokenDecimals ?? 18) : (assetDecimalsForChain(token.chainKey, NATIVE_SYMBOL[token.chainKey]) ?? 18);
          setQuote(summarizeQuote(q, receiveDecimalsFallback));
          setQuoteLoading(false);
        })
        .catch(err => {
          if (requestId !== quoteRequestIdRef.current) return;
          setQuote(null);
          rawQuoteRef.current = null;
          setQuoteLoading(false);
          setQuoteError(err instanceof Error ? err.message : 'Could not get a quote — try again.');
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isBuySide, amount, amtNum, session, token, tokenDecimals, slippageBps]);

  async function handleTrade() {
    const quoteToExecute = rawQuoteRef.current;
    if (!quoteToExecute || !session) return;
    setExecuteError(null);
    setExecuteWarnings([]);
    setExecuteTxHashes([]);
    try {
      const result = await executeRelayQuote(quoteToExecute, session, step => setExecuteState(step));
      setExecuteWarnings(result.warnings);
      setExecuteTxHashes(result.txHashes);
      setExecuteState('success');
    } catch (err) {
      // TransactionIntentError carries its own complete, user-facing
      // explanation (txIntentFirewall.ts's own fail() message) — shown
      // exactly as thrown, not re-wrapped, since re-wrapping it would
      // just be a worse paraphrase of a message already written for
      // this exact screen.
      const message = err instanceof TransactionIntentError ? err.message : err instanceof Error ? err.message : 'The trade failed. Nothing left this wallet unless a status above says otherwise.';
      setExecuteError(message);
      setExecuteState('error');
    }
  }

  const canTrade = Boolean(rawQuoteRef.current) && Boolean(session) && (executeState === 'idle' || executeState === 'error');
  const isExecuting = executeState !== 'idle' && executeState !== 'error' && executeState !== 'success';

  // Same real bug both DexScreen.tsx's own pillHint and the site's own
  // swapPillHint fix (the site's is a direct, explicitly-commented port
  // of mobile's — same priority order, reused here): a freshly opened
  // trade screen with no amount typed is the single most common state
  // here, and a dimmed pill that does nothing and says nothing reads as
  // broken, not as "you haven't told me how much yet". !session takes
  // top priority, same as both references' own "not connected" check —
  // "Unlock", not "Connect", since this wallet is embedded and local
  // rather than an external one to connect. Kept to the states that map
  // onto this screen (no balance/route-support gating here yet — that
  // lands with real balance-fetching); the errors block below the pay/
  // receive cards still owns every other message, so this never
  // duplicates one (same reasoning the site's own comment gives for
  // leaving `insufficient` out of its hint).
  const pillHint = !session
    ? 'Unlock your wallet to trade'
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
          onPress={() => (!isBuySide ? setIsBuySide(true) : canTrade && handleTrade())}
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
          onPress={() => (isBuySide ? setIsBuySide(false) : canTrade && handleTrade())}
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

      {/* Disabled: balance is null until balance-fetching is wired —
          same gating DexScreen.tsx's own quick-percent row already uses. */}
      <View style={styles.quickPctRow}>
        {QUICK_PCT_OPTIONS.map(pct => (
          <TouchableOpacity key={pct} style={styles.quickPctPill} disabled activeOpacity={0.7}>
            <Text style={styles.quickPctText}>{pct === 1 ? 'MAX' : `${pct * 100}%`}</Text>
          </TouchableOpacity>
        ))}
        <View style={[styles.quickPctPill, amtNum > 0 && styles.quickPctPillActive]}>
          <Text style={[styles.quickPctText, amtNum > 0 && styles.quickPctTextActive]}>Custom</Text>
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
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              style={[styles.amountInput, styles.prAmountInput]}
            />
          </View>
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
          {quote?.receiveAmountUsd != null && <Text style={styles.usdEquivText}>≈ ${quote.receiveAmountUsd.toFixed(2)}</Text>}
        </View>
      </View>

      {!isBuySide && tokenDecimalsError && <Text style={styles.errorText}>{tokenDecimalsError}</Text>}
      {!isBuySide && !tokenDecimalsError && tokenDecimals === null && amtNum > 0 && <Text style={styles.noteText}>Verifying this token…</Text>}
      {quoteError && <Text style={styles.errorText}>{quoteError}</Text>}

      <View style={styles.feeRow}>
        <View style={styles.feeRowLeft}>
          <View style={styles.feeDot} />
          <Text style={styles.feeText}>{quote?.totalFeeUsd != null ? `Fee $${quote.totalFeeUsd.toFixed(2)}` : `Fee ${formatFeePct(DEV_FEE_PCT)}%`}</Text>
        </View>
        <Text style={styles.etaText}>{quote?.etaSeconds != null ? `ETA: ${formatEta(quote.etaSeconds)}` : 'ETA: ~1 min'}</Text>
      </View>

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
    amountInput: {flex: 1, fontSize: 16, fontWeight: '600', color: colors.textPrimary},
    prAmountInput: {textAlign: 'right'},
    prReceiveAmount: {flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '600', textAlign: 'right'},
    receiveAmountTextMuted: {color: colors.textMuted},
    usdEquivText: {color: colors.textMuted, fontSize: 10, fontWeight: '600', textAlign: 'right', marginTop: 4},
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

    executeResult: {marginTop: 12, alignItems: 'center', gap: 4, paddingVertical: 10},
    executeSuccessText: {color: colors.gain, fontSize: 15, fontWeight: '700'},
    executeHashText: {color: colors.textMuted, fontSize: 11, fontFamily: 'monospace'},
    executeWarningText: {color: colors.warning, fontSize: 10.5, textAlign: 'center', marginTop: 2},
  });
}
