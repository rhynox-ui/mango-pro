// src/components/ConvertCashSheet.tsx
//
// Real answer to "how do I use my Robinhood USDG on any other chain":
// TokenTradeScreen's Pay-from picker already lets USDG fund a token buy
// directly, but a user who just wants their cash usable elsewhere
// (without picking a token first) needs a plain cash-to-cash move —
// this is that, modeled on the same "Convert" action every major
// exchange app already ships (a compact From/To sheet, not a full
// screen — this app's own existing BottomSheet, same one
// TradeSettingsSheet already uses, sized to its content rather than the
// screen).
//
// Real execution, same pipeline as every other trade in this app: one
// getRelayQuote() call (Relay bridges AND swaps the two cash assets in
// one intent — origin and destination currency can be on different
// chains, exactly like a cross-chain Buy) through executeRelayQuote.ts,
// which runs the pre-sign intent firewall before anything is signed.
// The one real difference from a token trade: waiveAppFee sends Mango's
// own app fee as 0bps (relayQuote.ts's own doc comment on that field
// explains why) — moving your own cash between its two real forms isn't
// a trade Mango takes a cut of. Real Relay/network costs still apply
// and show in the quote; only Mango's own fee is waived.

import {useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {parseUnits} from 'viem';
import {BottomSheet} from './BottomSheet';
import {NetworkIcon} from '../wallet/NetworkIcon';
import {CHAIN_LABEL, assetDecimalsForChain, currencyAddress, type ChainKey} from '../core/chainData';
import {CASH_ASSET_BY_CHAIN, CASH_SUPPORTED_CHAINS, type CashPortfolio} from '../core/usdcBalances';
import {getRelayQuote, summarizeQuote, type QuoteSummary} from '../core/relayQuote';
import {executeRelayQuote, type ExecuteStep} from '../core/executeRelayQuote';
import {TransactionIntentError} from '../core/txIntentFirewall';
import {addTxHistoryEntry} from '../wallet/txHistory';
import {formatAmountForInput} from '../wallet/useAvailableBalance';
import type {DerivedAccounts} from '../wallet/keys';
import {useTheme, type Colors} from '../theme/ThemeContext';

const QUOTE_DEBOUNCE_MS = 450;

function cashSymbol(chainKey: ChainKey): string {
  return CASH_ASSET_BY_CHAIN[chainKey] ?? 'USDC';
}

function balanceFor(cashPortfolio: CashPortfolio | null, chainKey: ChainKey): number {
  const result = cashPortfolio?.results.find(r => r.chainKey === chainKey);
  return result?.status === 'ok' ? result.balance : 0;
}

function pickDefaultFrom(cashPortfolio: CashPortfolio | null): ChainKey {
  let best: {chainKey: ChainKey; balance: number} | null = null;
  for (const chainKey of CASH_SUPPORTED_CHAINS) {
    const balance = balanceFor(cashPortfolio, chainKey);
    if (balance > 0 && (!best || balance > best.balance)) best = {chainKey, balance};
  }
  return best?.chainKey ?? 'robinhood';
}

function pickDefaultTo(fromChain: ChainKey, cashPortfolio: CashPortfolio | null): ChainKey {
  const candidates = CASH_SUPPORTED_CHAINS.filter(c => c !== fromChain);
  let best: {chainKey: ChainKey; balance: number} | null = null;
  for (const chainKey of candidates) {
    const balance = balanceFor(cashPortfolio, chainKey);
    if (balance > 0 && (!best || balance > best.balance)) best = {chainKey, balance};
  }
  return best?.chainKey ?? candidates.find(c => c === 'base') ?? candidates[0];
}

export function ConvertCashSheet({
  visible,
  onClose,
  session,
  cashPortfolio,
  onConverted,
}: {
  visible: boolean;
  onClose: () => void;
  session: DerivedAccounts | null;
  cashPortfolio: CashPortfolio | null;
  onConverted: () => void;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [view, setView] = useState<'form' | 'pick-from' | 'pick-to'>('form');
  const [fromChain, setFromChain] = useState<ChainKey>('robinhood');
  const [toChain, setToChain] = useState<ChainKey>('base');
  const [amount, setAmount] = useState('');

  const [quote, setQuote] = useState<QuoteSummary | null>(null);
  const rawQuoteRef = useRef<Awaited<ReturnType<typeof getRelayQuote>> | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteRequestIdRef = useRef(0);

  const [executeState, setExecuteState] = useState<ExecuteStep | 'idle' | 'success'>('idle');
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executeTxHashes, setExecuteTxHashes] = useState<string[]>([]);

  // Fresh defaults and a clean slate every time the sheet opens — never
  // carries a stale amount/quote/result into the next open.
  useEffect(() => {
    if (!visible) return;
    setView('form');
    const from = pickDefaultFrom(cashPortfolio);
    setFromChain(from);
    setToChain(pickDefaultTo(from, cashPortfolio));
    setAmount('');
    setQuote(null);
    rawQuoteRef.current = null;
    setQuoteError(null);
    setExecuteState('idle');
    setExecuteError(null);
    setExecuteTxHashes([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const amtNum = Number(amount) || 0;
  const fromBalance = balanceFor(cashPortfolio, fromChain);
  // Same guard TokenTradeScreen's own insufficientBalance uses (there
  // via `balance !== null`) — cashPortfolio not having resolved yet
  // reads identically to "balance is 0" via balanceFor's own fallback,
  // so without this a user typing an amount before that first fetch
  // lands would see a false "Insufficient balance" for a chain that
  // may well have real funds.
  const insufficientBalance = cashPortfolio !== null && amtNum > 0 && amtNum > fromBalance;
  const sameChain = fromChain === toChain;

  useEffect(() => {
    setQuoteError(null);
    setExecuteState('idle');
    setExecuteError(null);
    setExecuteTxHashes([]);
    if (amtNum <= 0 || sameChain || !session) {
      setQuote(null);
      rawQuoteRef.current = null;
      setQuoteLoading(false);
      return;
    }
    const payDecimals = assetDecimalsForChain(fromChain, cashSymbol(fromChain));
    if (payDecimals == null) {
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
      const userAddress = fromChain === 'solana' ? session.solana.address : session.evm.address;
      const recipientAddress = toChain === 'solana' ? session.solana.address : session.evm.address;
      const receiveDecimalsFallback = assetDecimalsForChain(toChain, cashSymbol(toChain)) ?? 6;
      getRelayQuote({
        fromChainKey: fromChain,
        toChainKey: toChain,
        originCurrency: currencyAddress(fromChain, cashSymbol(fromChain)),
        destinationCurrency: currencyAddress(toChain, cashSymbol(toChain)),
        amountBaseUnits,
        userAddress,
        recipientAddress,
        originAmountUsd: amtNum,
        waiveAppFee: true,
      })
        .then(q => {
          if (requestId !== quoteRequestIdRef.current) return;
          rawQuoteRef.current = q;
          setQuote(summarizeQuote(q, receiveDecimalsFallback));
          setQuoteLoading(false);
        })
        .catch(err => {
          if (requestId !== quoteRequestIdRef.current) return;
          rawQuoteRef.current = null;
          setQuote(null);
          setQuoteLoading(false);
          setQuoteError(err instanceof Error ? err.message : 'Could not get a conversion rate — try again.');
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fromChain, toChain, amount, amtNum, sameChain, session]);

  function handleMax() {
    setAmount(formatAmountForInput(fromBalance));
  }

  function handleSwapDirection() {
    const prevFrom = fromChain;
    setFromChain(toChain);
    setToChain(prevFrom);
    setAmount('');
  }

  async function handleConvert() {
    const quoteToExecute = rawQuoteRef.current;
    if (!quoteToExecute || !session) return;
    setExecuteError(null);
    setExecuteTxHashes([]);
    try {
      const result = await executeRelayQuote(quoteToExecute, session, step => setExecuteState(step));
      setExecuteTxHashes(result.txHashes);
      setExecuteState('success');
      addTxHistoryEntry({
        status: 'success',
        chainKey: toChain,
        chainLabel: CHAIN_LABEL[toChain],
        isBuySide: true,
        paySymbol: cashSymbol(fromChain),
        receiveSymbol: cashSymbol(toChain),
        payAmount: amount,
        receivedAmountFormatted: quote?.receivedAmountFormatted ?? null,
        hashes: result.txHashes,
        fromAddress: fromChain === 'solana' ? session.solana.address : session.evm.address,
      });
      onConverted();
    } catch (err) {
      setExecuteState('idle');
      const message = err instanceof TransactionIntentError ? err.message : err instanceof Error ? err.message : 'Conversion failed — try again.';
      setExecuteError(message);
      addTxHistoryEntry({
        status: 'error',
        chainKey: toChain,
        chainLabel: CHAIN_LABEL[toChain],
        isBuySide: true,
        paySymbol: cashSymbol(fromChain),
        receiveSymbol: cashSymbol(toChain),
        payAmount: amount,
        receivedAmountFormatted: null,
        hashes: [],
        errorMessage: message,
        fromAddress: fromChain === 'solana' ? session.solana.address : session.evm.address,
      });
    }
  }

  const isExecuting = executeState !== 'idle' && executeState !== 'success';
  const canConvert = !!session && !sameChain && amtNum > 0 && !insufficientBalance && !!quote && !quoteLoading && !isExecuting;

  const buttonLabel = !session
    ? 'Unlock your wallet'
    : sameChain
      ? 'Pick two different chains'
      : amtNum <= 0
        ? 'Enter an amount'
        : insufficientBalance
          ? `Insufficient ${cashSymbol(fromChain)} balance`
          : quoteLoading
            ? 'Finding rate…'
            : isExecuting
              ? executeStatusLabel(executeState)
              : executeState === 'success'
                ? 'Converted'
                : 'Convert';

  function renderChainPicker(forSide: 'from' | 'to') {
    const exclude = forSide === 'from' ? toChain : fromChain;
    return (
      <View>
        <View style={styles.pickerHeaderRow}>
          <TouchableOpacity onPress={() => setView('form')} hitSlop={8}>
            <Text style={styles.pickerClose}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{forSide === 'from' ? 'Convert from' : 'Convert to'}</Text>
          <View style={styles.pickerHeaderSpacer} />
        </View>
        {CASH_SUPPORTED_CHAINS.filter(c => c !== exclude).map(chainKey => {
          const balance = balanceFor(cashPortfolio, chainKey);
          const selected = (forSide === 'from' ? fromChain : toChain) === chainKey;
          return (
            <TouchableOpacity
              key={chainKey}
              style={styles.pickerRow}
              activeOpacity={0.7}
              onPress={() => {
                if (forSide === 'from') setFromChain(chainKey);
                else setToChain(chainKey);
                setAmount('');
                setView('form');
              }}>
              <NetworkIcon chainKey={chainKey} size={22} />
              <Text style={styles.pickerRowText}>
                {cashSymbol(chainKey)} on {CHAIN_LABEL[chainKey]}
              </Text>
              <Text style={styles.pickerRowBalance}>${balance.toFixed(2)}</Text>
              {selected && <Text style={styles.pickerCheck}>✓</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {view === 'pick-from' && renderChainPicker('from')}
      {view === 'pick-to' && renderChainPicker('to')}
      {view === 'form' && (
        <View>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Convert</Text>
            <View style={styles.freeBadge}>
              <Text style={styles.freeBadgeText}>Mango fee: Free</Text>
            </View>
          </View>

          <View style={styles.assetCard}>
            <View style={styles.assetCardTopRow}>
              <Text style={styles.assetCardLabel}>From</Text>
              <Text style={styles.availableText}>Available: ${fromBalance.toFixed(2)}</Text>
            </View>
            <View style={styles.assetCardMainRow}>
              <TouchableOpacity style={styles.assetSelector} onPress={() => setView('pick-from')} activeOpacity={0.7}>
                <NetworkIcon chainKey={fromChain} size={18} />
                <Text style={styles.assetSelectorText}>{cashSymbol(fromChain)}</Text>
                <Text style={styles.assetSelectorChevron}>⌄</Text>
              </TouchableOpacity>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.amountInput}
              />
            </View>
            <View style={styles.assetCardBottomRow}>
              <Text style={styles.chainCaption}>{CHAIN_LABEL[fromChain]}</Text>
              <TouchableOpacity onPress={handleMax} hitSlop={8}>
                <Text style={styles.maxText}>Max</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.swapRow}>
            <TouchableOpacity style={styles.swapButton} onPress={handleSwapDirection} activeOpacity={0.7}>
              <Text style={styles.swapButtonText}>⇅</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.assetCard}>
            <View style={styles.assetCardTopRow}>
              <Text style={styles.assetCardLabel}>To</Text>
              <Text style={styles.availableText}>Available: ${balanceFor(cashPortfolio, toChain).toFixed(2)}</Text>
            </View>
            <View style={styles.assetCardMainRow}>
              <TouchableOpacity style={styles.assetSelector} onPress={() => setView('pick-to')} activeOpacity={0.7}>
                <NetworkIcon chainKey={toChain} size={18} />
                <Text style={styles.assetSelectorText}>{cashSymbol(toChain)}</Text>
                <Text style={styles.assetSelectorChevron}>⌄</Text>
              </TouchableOpacity>
              {quoteLoading ? (
                <ActivityIndicator color={colors.textMuted} size="small" />
              ) : (
                <Text style={[styles.amountInput, styles.receiveAmountText, !quote?.receivedAmountFormatted && styles.receiveAmountMuted]} numberOfLines={1}>
                  {quote?.receivedAmountFormatted ?? '0'}
                </Text>
              )}
            </View>
            <Text style={styles.chainCaption}>{CHAIN_LABEL[toChain]}</Text>
          </View>

          {quote?.receivedAmountFormatted && amtNum > 0 && (
            <Text style={styles.rateText}>
              1 {cashSymbol(fromChain)} ≈ {(Number(quote.receivedAmountFormatted) / amtNum).toFixed(4)} {cashSymbol(toChain)}
            </Text>
          )}
          {quoteError && <Text style={styles.errorText}>{quoteError}</Text>}
          {executeError && <Text style={styles.errorText}>{executeError}</Text>}
          {executeState === 'success' && (
            <View style={styles.successBlock}>
              <Text style={styles.successText}>Converted</Text>
              {executeTxHashes.map(hash => (
                <Text key={hash} style={styles.hashText} selectable numberOfLines={1} ellipsizeMode="middle">
                  {hash}
                </Text>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.convertButton, !canConvert && styles.convertButtonDisabled]}
            onPress={handleConvert}
            disabled={!canConvert}
            activeOpacity={0.85}>
            {isExecuting ? <ActivityIndicator color={colors.ctaText} size="small" /> : <Text style={styles.convertButtonText}>{buttonLabel}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  );
}

function executeStatusLabel(state: ExecuteStep): string {
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
    headerRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16},
    title: {color: colors.textPrimary, fontSize: 17, fontWeight: '800'},
    freeBadge: {backgroundColor: colors.pillBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5},
    freeBadgeText: {color: colors.gain, fontSize: 11, fontWeight: '700'},

    assetCard: {backgroundColor: colors.pillBg, borderRadius: 14, padding: 12, gap: 6},
    assetCardTopRow: {flexDirection: 'row', justifyContent: 'space-between'},
    assetCardLabel: {color: colors.textMuted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6},
    availableText: {color: colors.textMuted, fontSize: 11},
    assetCardMainRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
    assetSelector: {flexDirection: 'row', alignItems: 'center', gap: 6},
    assetSelectorText: {color: colors.textPrimary, fontSize: 15, fontWeight: '800'},
    assetSelectorChevron: {color: colors.textMuted, fontSize: 12},
    amountInput: {flex: 1, textAlign: 'right', color: colors.textPrimary, fontSize: 20, fontWeight: '700', padding: 0, marginLeft: 12},
    receiveAmountText: {color: colors.textSecondary},
    receiveAmountMuted: {color: colors.textMuted},
    assetCardBottomRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
    chainCaption: {color: colors.textMuted, fontSize: 10.5},
    maxText: {color: colors.textPrimary, fontSize: 11.5, fontWeight: '700'},

    swapRow: {alignItems: 'center', marginVertical: -10, zIndex: 1},
    swapButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swapButtonText: {color: colors.textPrimary, fontSize: 15},

    rateText: {color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12},
    errorText: {color: colors.danger, fontSize: 12, marginTop: 10},
    successBlock: {marginTop: 10, gap: 4},
    successText: {color: colors.gain, fontSize: 13, fontWeight: '700'},
    hashText: {color: colors.textMuted, fontSize: 10.5},

    convertButton: {backgroundColor: colors.ctaBg, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 16},
    convertButtonDisabled: {opacity: 0.5},
    convertButtonText: {color: colors.ctaText, fontSize: 14.5, fontWeight: '800'},

    pickerHeaderRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12},
    pickerHeaderSpacer: {width: 32},
    pickerClose: {color: colors.textMuted, fontSize: 13, fontWeight: '600'},
    pickerRow: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12},
    pickerRowText: {flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '600'},
    pickerRowBalance: {color: colors.textMuted, fontSize: 12},
    pickerCheck: {color: colors.textPrimary, fontSize: 14, fontWeight: '800', marginLeft: 6},
  });
}
