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
// - Buy-side quotes are real, live Relay quotes (src/core/relayQuote.ts)
//   once a wallet is unlocked — typing an amount debounces into an
//   actual quote request, and "You receive"/fee/ETA reflect Relay's own
//   numbers when one comes back.
// - Sell-side quotes are NOT wired yet: converting a typed token amount
//   into base units needs that token's on-chain decimals, which an
//   arbitrary searched token doesn't carry (DexScreener's search
//   response doesn't include it) — a real on-chain decimals() read is
//   needed and isn't built yet. Shown as an honest note, not faked.
// - Balances are still null (no balance-fetching wired yet), so the
//   percent-quick-fill row stays correctly disabled.
// - No execute/sign step yet — this only gets as far as a quote. Signing
//   needs the intent-firewall + calldata-decode confirm screen (build
//   plan §5), not built here yet.

import {useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {parseUnits} from 'viem';
import {TokenChartPanel} from '../components/TokenChartPanel';
import {CHAIN_LABEL, NATIVE_SYMBOL, assetDecimalsForChain, currencyAddress, type ChainKey} from '../core/chainData';
import {DEV_FEE_PCT} from '../core/fees';
import {getRelayQuote, summarizeQuote, type QuoteSummary} from '../core/relayQuote';
import {useSession} from '../wallet/SessionContext';
import {useTheme, type Colors} from '../theme/ThemeContext';

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
  onOpenSettings,
}: {
  token?: DemoToken;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
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

  const paySymbol = isBuySide ? NATIVE_SYMBOL[token.chainKey] : token.symbol;
  const receiveSymbol = isBuySide ? token.symbol : NATIVE_SYMBOL[token.chainKey];
  const amtNum = Number(amount) || 0;

  useEffect(() => {
    setQuoteError(null);
    if (!isBuySide || amtNum <= 0) {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    if (!session) {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    const nativeDecimals = assetDecimalsForChain(token.chainKey, NATIVE_SYMBOL[token.chainKey]);
    if (nativeDecimals === undefined) {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }

    setQuoteLoading(true);
    const requestId = ++quoteRequestIdRef.current;
    const timer = setTimeout(() => {
      let amountBaseUnits: string;
      try {
        amountBaseUnits = parseUnits(amount, nativeDecimals).toString();
      } catch {
        setQuoteLoading(false);
        return;
      }
      const userAddress = token.chainKey === 'solana' ? session.solana.address : session.evm.address;
      getRelayQuote({
        fromChainKey: token.chainKey,
        toChainKey: token.chainKey,
        originCurrency: currencyAddress(token.chainKey, NATIVE_SYMBOL[token.chainKey]),
        destinationCurrency: token.address,
        amountBaseUnits,
        userAddress,
      })
        .then(q => {
          // Stale-response guard — a slower earlier request landing
          // after a faster later one would otherwise flash outdated numbers.
          if (requestId !== quoteRequestIdRef.current) return;
          setQuote(summarizeQuote(q, 18));
          setQuoteLoading(false);
        })
        .catch(err => {
          if (requestId !== quoteRequestIdRef.current) return;
          setQuote(null);
          setQuoteLoading(false);
          setQuoteError(err instanceof Error ? err.message : 'Could not get a quote — try again.');
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isBuySide, amount, amtNum, session, token]);

  return (
    <View style={styles.screen}>
      <View style={styles.chainRow}>
        <View style={styles.chainPill}>
          <Text style={styles.chainPillLabel}>Trading on </Text>
          <Text style={styles.chainPillValue}>{CHAIN_LABEL[token.chainKey]}</Text>
        </View>
        <TouchableOpacity style={styles.iconPill} onPress={onOpenSearch} activeOpacity={0.7}>
          <SearchGlyph color={colors.textSecondary} />
          <Text style={styles.iconPillLabel}>Search</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconSquarePill} onPress={onOpenSettings} activeOpacity={0.7} accessibilityLabel="Trade settings">
          <SettingsGlyph color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* The chart gets the vertical room a Swap/Limit/DCA tab row would
          otherwise have taken — Mango Pro deliberately has no Limit/DCA,
          per the product decision behind this screen. */}
      <TokenChartPanel chainKey={token.chainKey} tokenAddress={token.address} />

      {/* Buy/Sell — the inactive side flips direction, same as
          DexScreen.tsx's own handleSwapAssets(); there's no execute step
          yet to gate a submit on, so both sides just toggle for now. */}
      <View style={styles.buySellRow}>
        <TouchableOpacity
          onPress={() => setIsBuySide(true)}
          style={[styles.buySellPillBuy, isBuySide && styles.buySellPillBuyActive]}
          activeOpacity={0.8}>
          <Text style={[styles.buySellArrowBuy, isBuySide && styles.buySellTextOnColor]}>↗</Text>
          <Text style={[styles.buySellTextBuy, isBuySide && styles.buySellTextOnColor]}>Buy</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setIsBuySide(false)}
          style={[styles.buySellPillSell, !isBuySide && styles.buySellPillSellActive]}
          activeOpacity={0.8}>
          <Text style={[styles.buySellArrowSell, !isBuySide && styles.buySellTextOnColor]}>↘</Text>
          <Text style={[styles.buySellTextSell, !isBuySide && styles.buySellTextOnColor]}>Sell</Text>
        </TouchableOpacity>
      </View>

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
            <View style={styles.assetSelector}>
              <Text style={styles.assetSelectorText}>{paySymbol}</Text>
            </View>
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
            <View style={styles.assetSelector}>
              <Text style={styles.assetSelectorText}>{receiveSymbol}</Text>
            </View>
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

      {!isBuySide && <Text style={styles.noteText}>Sell quotes need the token's on-chain decimals, not wired up yet — Buy quotes are live.</Text>}
      {quoteError && <Text style={styles.errorText}>{quoteError}</Text>}
      {isBuySide && amtNum > 0 && !session && !quoteError && <Text style={styles.noteText}>Unlock your wallet to get a live quote.</Text>}

      <View style={styles.feeRow}>
        <View style={styles.feeRowLeft}>
          <View style={styles.feeDot} />
          <Text style={styles.feeText}>{quote?.totalFeeUsd != null ? `Fee $${quote.totalFeeUsd.toFixed(2)}` : `Fee ${formatFeePct(DEV_FEE_PCT)}%`}</Text>
        </View>
        <Text style={styles.etaText}>{quote?.etaSeconds != null ? `ETA: ${formatEta(quote.etaSeconds)}` : 'ETA: ~1 min'}</Text>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, padding: 16},
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
    buySellArrowBuy: {fontSize: 14, fontWeight: '800', color: colors.gain},
    buySellArrowSell: {fontSize: 14, fontWeight: '800', color: colors.danger},
    buySellTextBuy: {fontSize: 13.5, fontWeight: '700', color: colors.gain},
    buySellTextSell: {fontSize: 13.5, fontWeight: '700', color: colors.danger},
    buySellTextOnColor: {color: '#fff'},
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
  });
}
