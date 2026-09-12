// src/screens/ProfileScreen.tsx
//
// Reached via the bottom nav's Profile tab. Unlike Home's discovery feed
// (deliberately mocked so the product demos with something in it), this
// screen shows a genuinely new account's real state: $0 balance, no
// trades, no followers — there's no auth/account system yet (build plan
// Phase 0), so fabricating a populated-looking profile here would be
// lying about what's actually built, not demonstrating the product.
// "Joined <month year>" is the one real data point: today's date.

import {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';
import Svg, {Defs, LinearGradient, Line as SvgLine, Path as SvgPath, Stop} from 'react-native-svg';
import {
  ArrowUpIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GearIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  UploadIcon,
} from '../components/icons';
import {CHAIN_LABEL, type ChainKey} from '../core/chainData';
import {fetchCashPortfolio, CASH_ASSET_BY_CHAIN, CASH_SUPPORTED_CHAINS, type CashPortfolio} from '../core/usdcBalances';
import {ConvertCashSheet} from '../components/ConvertCashSheet';
import {NetworkIcon} from '../wallet/NetworkIcon';
import {sendUsdc, isValidRecipientAddress} from '../wallet/sendUsdc';
import {filterTxHistoryForAccount, getTxHistory, subscribeTxHistory, type TxHistoryEntry} from '../wallet/txHistory';
import {getAvatarUri, getBio, getUsername, isValidUsername, setAvatarUri as saveAvatarUri, setBio as saveBio, setUsername as saveUsername} from '../wallet/profileLocal';
import {computePortfolioChange, filterHistoryByRange, getPortfolioHistory, recordPortfolioSnapshot, type PortfolioSnapshot} from '../wallet/portfolioHistory';
import {ReferralModal} from '../referral/ReferralModal';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {useSession} from '../wallet/SessionContext';

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

// Every cash chain except Solana shares the SAME EVM address — this is
// what "deposit on whichever chain works for you" actually reduces to
// for a user: one address, valid everywhere in this list, plus a
// separate Solana address for the one non-EVM chain.
const EVM_CASH_CHAINS = CASH_SUPPORTED_CHAINS.filter(c => c !== 'solana');

// Adapted from FOMO's own deposit flow shape (pick a network -> show
// the address for that one network). FOMO's reference also offers a
// debit-card/bank/exchange-app method picker ahead of this — dropped
// entirely rather than shown as "Coming soon": there's no fiat on/off-
// ramp on any real roadmap here, and "Coming soon" is for things this
// app is actually going to build, not a place to park things it isn't.
// Crypto (this list) is the one real, capable method, so it's the
// whole flow, not a choice among several.
type DepositStep = 'network' | 'address';

// Same reasoning as DepositStep above, applied to FOMO's own "Choose
// withdraw method" screen — no bank-account or finance-app row, just
// the one real method (this app's non-custodial sendUsdc.ts).
type WithdrawStep = 'network' | 'form' | 'sending' | 'success' | 'error';

const TIME_RANGES = ['24h', '7d', '30d', 'All'] as const;
type TimeRange = (typeof TIME_RANGES)[number];

const POSITION_TABS = ['Open', 'Closed'] as const;
type PositionTab = (typeof POSITION_TABS)[number];

const ASSET_FILTERS = ['All', 'Tokens', 'Perps'] as const;
type AssetFilterKey = (typeof ASSET_FILTERS)[number];

function joinedLabel(): string {
  const now = new Date();
  return `Joined ${now.toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}`;
}

// Same relative-time convention HistoryScreen.tsx's own formatWhen uses,
// kept as its own small local copy rather than importing across screens
// for one function — same reasoning TokenTradeScreen.tsx's own
// formatUsd gives for not sharing formatters across screens.
function formatWhen(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
}

export function ProfileScreen({
  onOpenSettings,
  onOpenHistory,
  pendingAction,
  onPendingActionHandled,
}: {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  /** Set by App.tsx when navigation here should also open a specific action (e.g. Settings' "Deposit and Withdraw" row, or Home's own Deposit button) — consumed once below, not a persistent mode. */
  pendingAction?: 'withdraw' | 'deposit' | null;
  onPendingActionHandled?: () => void;
}) {
  const {colors} = useTheme();
  const {session} = useSession();
  const styles = makeStyles(colors);
  const [depositStep, setDepositStep] = useState<DepositStep | null>(null);
  const [depositChain, setDepositChain] = useState<ChainKey | null>(null);
  // True only for the dedicated "Robinhood Chain — ETH for gas" row —
  // every other deposit row (including Robinhood's own real cash asset,
  // USDG, in the main list below) leaves this false and reads its asset
  // from CASH_ASSET_BY_CHAIN instead. Two genuinely different real
  // assets on the same chain, so one boolean disambiguates rather than
  // guessing from chainKey alone.
  const [depositIsNativeGas, setDepositIsNativeGas] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [withdrawStep, setWithdrawStep] = useState<WithdrawStep | null>(null);
  const [withdrawChain, setWithdrawChain] = useState<ChainKey | null>(null);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawTxId, setWithdrawTxId] = useState<string | null>(null);
  const [cashPortfolio, setCashPortfolio] = useState<CashPortfolio | null>(null);
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);
  const [usdcLoading, setUsdcLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [positionTab, setPositionTab] = useState<PositionTab>('Open');
  const [assetFilter, setAssetFilter] = useState<AssetFilterKey>('All');
  const joined = useMemo(joinedLabel, []);

  // Real, local-only bio + avatar (src/wallet/profileLocal.ts) — loaded
  // fresh per account address so switching wallets on this device never
  // shows a stale bio/photo from a different one.
  const [bio, setBioValue] = useState('');
  const [bioEditing, setBioEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [avatarUri, setAvatarUriValue] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  // Real, local-only username — same storage shape as bio/avatar. Once
  // set, this replaces the raw address as the identity shown up top (a
  // real user-chosen handle beats a hex string), and the address itself
  // drops out of that spot — it's still real and still shown in full in
  // the Deposit modal, so nothing is actually hidden, just not repeated
  // where a username now does that job.
  const [username, setUsernameValue] = useState('');
  const [showReferral, setShowReferral] = useState(false);
  const [usernameEditing, setUsernameEditing] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameError, setUsernameError] = useState('');
  useEffect(() => {
    if (!session) return;
    const address = session.evm.address;
    let cancelled = false;
    Promise.all([getBio(address), getAvatarUri(address), getUsername(address)]).then(([loadedBio, loadedAvatar, loadedUsername]) => {
      if (cancelled) return;
      setBioValue(loadedBio);
      setAvatarUriValue(loadedAvatar);
      setAvatarFailed(false);
      setUsernameValue(loadedUsername);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  function openBioEditor() {
    setBioDraft(bio);
    setBioEditing(true);
  }

  async function handleSaveBio() {
    if (!session) return;
    const trimmed = bioDraft.trim();
    await saveBio(session.evm.address, trimmed);
    setBioValue(trimmed);
    setBioEditing(false);
  }

  function openUsernameEditor() {
    setUsernameDraft(username);
    setUsernameError('');
    setUsernameEditing(true);
  }

  async function handleSaveUsername() {
    if (!session) return;
    const trimmed = usernameDraft.trim();
    if (trimmed && !isValidUsername(trimmed)) {
      setUsernameError('3-20 characters, starting with a letter — letters, numbers, and underscore only.');
      return;
    }
    await saveUsername(session.evm.address, trimmed);
    setUsernameValue(trimmed);
    setUsernameEditing(false);
  }

  async function handlePickAvatar() {
    if (!session) return;
    // includeBase64 + a capped maxWidth/maxHeight/quality: the picker's
    // own real, built-in downsizing (not custom compression code this
    // app would have to write) keeps the resulting data URI a reasonable
    // size for permanent storage in AsyncStorage — see profileLocal.ts's
    // own header for why bytes-in-storage, not a file path, is the
    // actually-permanent choice here.
    const result = await launchImageLibrary({mediaType: 'photo', selectionLimit: 1, includeBase64: true, maxWidth: 512, maxHeight: 512, quality: 0.7});
    if (result.didCancel) return;
    if (result.errorCode) {
      Alert.alert('Could not open photo library', result.errorMessage ?? 'Please try again.');
      return;
    }
    const asset = result.assets?.[0];
    if (!asset?.base64) return;
    const dataUri = `data:${asset.type ?? 'image/jpeg'};base64,${asset.base64}`;
    await saveAvatarUri(session.evm.address, dataUri);
    setAvatarUriValue(dataUri);
    setAvatarFailed(false);
  }

  // Real trade count for the meta chip below, and the real trades
  // behind the Positions section's own "Closed" tab (see its own render
  // site) — both were a hardcoded "0 trades"/"No closed positions yet"
  // before txHistory.ts existed, same "real shell, not a mock" reasoning
  // as everything else this screen shows for a new account. "Open"
  // positions stay a real empty state — this app has no live balance/
  // PnL tracking of held tokens yet, a materially bigger feature than
  // just listing what already happened.
  const [tradeCount, setTradeCount] = useState(0);
  const [closedTrades, setClosedTrades] = useState<TxHistoryEntry[]>([]);
  useEffect(() => {
    function recount(entries: ReturnType<typeof getTxHistory>) {
      const scoped = session ? filterTxHistoryForAccount(entries, {evmAddress: session.evm.address, solanaAddress: session.solana.address}) : entries;
      const successful = scoped.filter(e => e.status === 'success');
      setTradeCount(successful.length);
      setClosedTrades(successful);
    }
    recount(getTxHistory());
    return subscribeTxHistory(recount);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    // Show whatever history already exists on disk immediately, rather
    // than leaving the chart empty until the network fetch below
    // resolves — the fetch only ever appends to this, never replaces it.
    getPortfolioHistory(session.evm.address).then(history => {
      if (!cancelled) setPortfolioHistory(history);
    });
    setUsdcLoading(true);
    fetchCashPortfolio(session).then(portfolio => {
      if (cancelled) return;
      setCashPortfolio(portfolio);
      setUsdcLoading(false);
      // Only record a snapshot from a COMPLETE fetch — one chain's RPC
      // hiccup would otherwise write a real but artificially low total
      // into history as a fake dip that never actually happened.
      if (portfolio.complete) {
        recordPortfolioSnapshot(session.evm.address, portfolio.totalUsd).then(history => {
          if (!cancelled) setPortfolioHistory(history);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (pendingAction === 'withdraw') {
      setWithdrawStep('network');
      onPendingActionHandled?.();
    } else if (pendingAction === 'deposit') {
      setDepositStep('network');
      onPendingActionHandled?.();
    }
    // onPendingActionHandled is a fresh closure every render (App.tsx
    // doesn't memoize it) — only pendingAction's own value should
    // re-trigger this, or it would fire on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction]);

  function refreshCashPortfolio() {
    if (!session) return;
    fetchCashPortfolio(session).then(portfolio => {
      setCashPortfolio(portfolio);
      if (portfolio.complete) {
        recordPortfolioSnapshot(session.evm.address, portfolio.totalUsd).then(setPortfolioHistory);
      }
    });
  }

  function balanceForChain(chainKey: ChainKey | null): number {
    if (!chainKey || !cashPortfolio) return 0;
    const result = cashPortfolio.results.find(r => r.chainKey === chainKey);
    return result?.status === 'ok' ? result.balance : 0;
  }

  const rangedHistory = useMemo(() => filterHistoryByRange(portfolioHistory, timeRange), [portfolioHistory, timeRange]);
  const portfolioChange = useMemo(() => computePortfolioChange(rangedHistory), [rangedHistory]);
  const chartColor = portfolioChange && !portfolioChange.isPositive ? colors.danger : colors.gain;

  // Straight-segment sparkline over the already range-filtered points —
  // no smoothing library needed for a handful of real data points, and
  // straight segments never invent a curve the real numbers didn't have.
  const chartPaths = useMemo(() => {
    if (rangedHistory.length < 2) return null;
    const values = rangedHistory.map(p => p.totalUsd);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const span = maxVal - minVal || 1;
    const padTop = 8;
    const plotHeight = 90 - padTop * 2;
    const coords = rangedHistory.map((point, i) => {
      const x = (i / (rangedHistory.length - 1)) * 300;
      const y = padTop + (1 - (point.totalUsd - minVal) / span) * plotHeight;
      return {x, y};
    });
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
    const area = `${line} L${coords[coords.length - 1].x.toFixed(2)},90 L${coords[0].x.toFixed(2)},90 Z`;
    return {line, area};
  }, [rangedHistory]);

  function resetWithdraw() {
    setWithdrawStep(null);
    setWithdrawChain(null);
    setWithdrawAddress('');
    setWithdrawAmount('');
    setWithdrawError(null);
    setWithdrawTxId(null);
  }

  async function handleConfirmWithdraw() {
    if (!session || !withdrawChain) return;
    setWithdrawStep('sending');
    try {
      const {txId} = await sendUsdc(withdrawChain, session, withdrawAddress.trim(), withdrawAmount, CASH_ASSET_BY_CHAIN[withdrawChain]);
      setWithdrawTxId(txId);
      setWithdrawStep('success');
      refreshCashPortfolio();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'The send failed. Nothing left this wallet.');
      setWithdrawStep('error');
    }
  }

  const withdrawAmountNumber = Number(withdrawAmount);
  const withdrawChainBalance = balanceForChain(withdrawChain);
  const canSubmitWithdraw =
    withdrawChain !== null &&
    isValidRecipientAddress(withdrawChain, withdrawAddress.trim()) &&
    withdrawAmountNumber > 0 &&
    withdrawAmountNumber <= withdrawChainBalance;

  return (
    <ScrollView style={styles.screen} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerIcons}>
        <TouchableOpacity hitSlop={8} onPress={onOpenHistory}>
          <HistoryIcon color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity hitSlop={8} onPress={onOpenSettings}>
          <GearIcon color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.identityRow}>
        <View style={styles.avatarWrap}>
          {avatarUri && !avatarFailed ? (
            <Image source={{uri: avatarUri}} style={styles.avatarImage} onError={() => setAvatarFailed(true)} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>Y</Text>
            </View>
          )}
          <TouchableOpacity style={styles.avatarEditButton} hitSlop={6} onPress={handlePickAvatar}>
            <PencilIcon color={colors.bg} size={11} />
          </TouchableOpacity>
        </View>
        <View style={styles.identityActions}>
          <TouchableOpacity style={styles.shareButton} hitSlop={6} onPress={() => setShowReferral(true)}>
            <UploadIcon color={colors.textPrimary} size={15} />
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity onPress={openUsernameEditor}>
        <Text style={styles.name}>{username ? `@${username}` : 'Your Profile'}</Text>
      </TouchableOpacity>
      {/* Real, explicit product decision: the raw wallet address never
          shows here at all, even as a before-you-set-one fallback — a
          wallet address isn't an identity anyone chose, and showing it
          only trained people to treat it as one. It's still shown in
          full where it's actually needed (the Deposit modal); this spot
          is purely "how you're identified," so before a username
          exists it prompts for one instead of leaking the address. */}
      {!username && (
        <TouchableOpacity onPress={openUsernameEditor}>
          <Text style={styles.addBio}>+ Set a username</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={openBioEditor}>
        {bio ? <Text style={styles.bioText}>{bio}</Text> : <Text style={styles.addBio}>+ Add a bio</Text>}
      </TouchableOpacity>

      <View style={styles.socialRow}>
        <Text style={styles.socialText}>
          <Text style={styles.socialCount}>0</Text> Following
        </Text>
        <Text style={styles.socialText}>
          <Text style={styles.socialCount}>0</Text> Followers
        </Text>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <HistoryIcon color={colors.textMuted} size={13} />
          <Text style={styles.metaText}>New account</Text>
        </View>
        <View style={styles.metaItem}>
          <RepeatIcon color={colors.textMuted} size={13} />
          <Text style={styles.metaText}>{tradeCount} {tradeCount === 1 ? 'trade' : 'trades'}</Text>
        </View>
        <View style={styles.metaItem}>
          <CalendarIcon color={colors.textMuted} size={13} />
          <Text style={styles.metaText}>{joined}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.portfolioHeader}>
        <View>
          <Text style={styles.portfolioValue}>${cashPortfolio ? formatUsd(cashPortfolio.totalUsd) : '0.00'}</Text>
          {portfolioChange && (
            <Text style={[styles.portfolioChange, portfolioChange.isPositive ? styles.portfolioChangePositive : styles.portfolioChangeNegative]}>
              {portfolioChange.isPositive ? '+' : '-'}${formatUsd(Math.abs(portfolioChange.absolute))} ({portfolioChange.isPositive ? '+' : '-'}
              {Math.abs(portfolioChange.percent).toFixed(2)}%)
            </Text>
          )}
        </View>
        <View style={styles.rangeRow}>
          {TIME_RANGES.map(r => (
            <TouchableOpacity
              key={r}
              onPress={() => setTimeRange(r)}
              style={[styles.rangePill, timeRange === r && styles.rangePillActive]}
              activeOpacity={0.7}>
              <Text style={[styles.rangePillText, timeRange === r && styles.rangePillTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.chartArea}>
        {chartPaths ? (
          <Svg width="100%" height={90} viewBox="0 0 300 90" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={chartColor} stopOpacity={0.22} />
                <Stop offset="1" stopColor={chartColor} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <SvgPath d={chartPaths.area} fill="url(#portfolioGradient)" stroke="none" />
            <SvgPath d={chartPaths.line} stroke={chartColor} strokeWidth={2} fill="none" />
          </Svg>
        ) : (
          <>
            <Svg width="100%" height={90} viewBox="0 0 300 90" preserveAspectRatio="none">
              <SvgLine x1="0" y1="45" x2="300" y2="45" stroke={colors.panelBorder} strokeWidth={2} />
            </Svg>
            <Text style={styles.chartCaption}>
              {portfolioHistory.length >= 2 ? `Not enough history yet for ${timeRange}.` : 'No portfolio history yet — trade to start your chart.'}
            </Text>
          </>
        )}
      </View>

      <View style={styles.totalCashRow}>
        <View style={styles.totalCashLeft}>
          <View style={styles.totalCashIcon}>
            <Text style={styles.totalCashIconText}>$</Text>
          </View>
          <View>
            <Text style={styles.totalCashLabel}>Total cash</Text>
            {usdcLoading ? (
              <ActivityIndicator color={colors.textMuted} size="small" style={styles.totalCashSpinner} />
            ) : (
              <Text style={styles.totalCashValue}>${cashPortfolio ? formatUsd(cashPortfolio.totalUsd) : '0.00'}</Text>
            )}
            {cashPortfolio && !cashPortfolio.complete && (
              <Text style={styles.totalCashNote}>Some chains didn't respond — this may be incomplete.</Text>
            )}
          </View>
        </View>
        <View style={styles.totalCashActions}>
          <TouchableOpacity style={styles.squareButton} hitSlop={4} onPress={() => setDepositStep('network')}>
            <PlusIcon color={colors.textPrimary} size={16} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.squareButton} hitSlop={4} onPress={() => setWithdrawStep('network')}>
            <ArrowUpIcon color={colors.textPrimary} size={16} />
          </TouchableOpacity>
          {/* Real fix for a wallet whose cash sits as USDG on Robinhood
              Chain: before this, that balance could be seen here and
              spent on a Robinhood-chain token (TokenTradeScreen's own
              Pay-from picker) but had no way to become spendable
              elsewhere. Convert moves it (or any cash chain's balance)
              into another cash chain's real asset via the same Relay
              pipeline every trade uses, fee-free (ConvertCashSheet's
              own header explains why). */}
          <TouchableOpacity style={styles.squareButton} hitSlop={4} onPress={() => setConvertOpen(true)}>
            <RepeatIcon color={colors.textPrimary} size={16} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.positionsHeaderRow}>
        <Text style={styles.positionsHeading}>Positions</Text>
        <View style={styles.segmented}>
          {POSITION_TABS.map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => setPositionTab(t)}
              style={[styles.segment, positionTab === t && styles.segmentActive]}
              activeOpacity={0.7}>
              {t === 'Open' && <View style={[styles.segmentDot, positionTab === t && styles.segmentDotActive]} />}
              <Text style={[styles.segmentText, positionTab === t && styles.segmentTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.assetFilterRow}>
        {ASSET_FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            onPress={() => setAssetFilter(f)}
            style={[styles.assetFilterPill, assetFilter === f && styles.assetFilterPillActive]}
            activeOpacity={0.7}>
            <Text style={[styles.assetFilterText, assetFilter === f && styles.assetFilterTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* This app has nothing that's actually a Perp yet, so the Perps
          filter always reads as empty here — an honest reflection of
          what exists, not a bug. */}
      {positionTab === 'Closed' && assetFilter !== 'Perps' && closedTrades.length > 0 ? (
        <View style={styles.closedTradesList}>
          {closedTrades.map(trade => (
            <View key={trade.id} style={styles.closedTradeRow}>
              <View style={[styles.closedTradeDot, !trade.isBuySide && styles.closedTradeDotSell]} />
              <View style={styles.closedTradeMain}>
                <Text style={styles.closedTradeTitle} numberOfLines={1}>
                  {trade.isBuySide ? 'Bought' : 'Sold'} {trade.isBuySide ? trade.receiveSymbol : trade.paySymbol} on {trade.chainLabel}
                </Text>
                <Text style={styles.closedTradeSubtitle} numberOfLines={1}>
                  {trade.payAmount} {trade.paySymbol} → {trade.receivedAmountFormatted ?? '?'} {trade.receiveSymbol}
                </Text>
              </View>
              <Text style={styles.closedTradeWhen}>{formatWhen(trade.timestamp)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyPositions}>{positionTab === 'Open' ? 'No open positions' : 'No closed positions yet'}</Text>
      )}

      <TouchableOpacity style={styles.showHiddenPill} activeOpacity={0.7}>
        <Text style={styles.showHiddenText}>Show hidden</Text>
      </TouchableOpacity>

      <Modal
        visible={depositStep !== null || withdrawStep !== null}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setDepositStep(null);
          setDepositChain(null);
          resetWithdraw();
        }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {depositStep === 'network' && (
              <>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Deposit</Text>
                  <TouchableOpacity onPress={() => setDepositStep(null)} hitSlop={8}>
                    <Text style={styles.modalClose}>Close</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalSubtitle}>Choose a network to deposit from.</Text>

                {/* Real per-chain cash asset — USDC everywhere except
                    Robinhood Chain, which has its own real stablecoin
                    (USDG) instead; CASH_ASSET_BY_CHAIN is the one place
                    that distinction lives, so this list never needs to
                    special-case it. */}
                {CASH_SUPPORTED_CHAINS.map(chainKey => (
                  <TouchableOpacity
                    key={chainKey}
                    style={styles.networkRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      setDepositChain(chainKey);
                      setDepositIsNativeGas(false);
                      setDepositStep('address');
                    }}>
                    <View style={styles.networkRowLeft}>
                      <NetworkIcon chainKey={chainKey} size={22} />
                      <Text style={styles.networkRowText}>{CHAIN_LABEL[chainKey]}</Text>
                    </View>
                    <ChevronRightIcon color={colors.textMuted} size={16} />
                  </TouchableOpacity>
                ))}

                {/* Separate from the row above: this is Robinhood
                    Chain's NATIVE ETH specifically, for paying gas on a
                    trade there — a genuinely different real asset from
                    the USDG row already in the list above, not a
                    duplicate of it. Without this row a user would have
                    no way to fund gas there directly at all. */}
                <Text style={styles.modalSectionLabel}>Native asset — for gas</Text>
                <TouchableOpacity
                  style={styles.networkRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    setDepositChain('robinhood');
                    setDepositIsNativeGas(true);
                    setDepositStep('address');
                  }}>
                  <View style={styles.networkRowLeft}>
                    <NetworkIcon chainKey="robinhood" size={22} />
                    <Text style={styles.networkRowText}>{CHAIN_LABEL.robinhood} — ETH</Text>
                  </View>
                  <ChevronRightIcon color={colors.textMuted} size={16} />
                </TouchableOpacity>
              </>
            )}

            {depositStep === 'address' && depositChain && (
              <>
                <View style={styles.modalHeaderRow}>
                  <TouchableOpacity onPress={() => setDepositStep('network')} hitSlop={8}>
                    <ChevronLeftIcon color={colors.textPrimary} size={20} />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>{CHAIN_LABEL[depositChain]}</Text>
                  <View style={styles.modalHeaderSpacer} />
                </View>

                <Text style={styles.modalSectionLabel}>Your {CHAIN_LABEL[depositChain]} address</Text>
                <Text style={styles.modalAddress} selectable numberOfLines={1} ellipsizeMode="middle">
                  {depositChain === 'solana' ? (session?.solana.address ?? '—') : (session?.evm.address ?? '—')}
                </Text>
                <Text style={styles.modalHint}>
                  {depositChain === 'solana'
                    ? "A separate address — Solana isn't an EVM chain, so it can't share the address other networks use."
                    : depositIsNativeGas
                      ? 'The same address as every other EVM network here — this deposit is for gas specifically, separate from the USDG row above.'
                      : `The same address also works on: ${EVM_CASH_CHAINS.filter(c => c !== depositChain)
                          .map(c => CHAIN_LABEL[c])
                          .join(', ')}.`}
                </Text>
                <Text style={styles.modalWarning}>
                  {depositIsNativeGas
                    ? `Only send ETH on ${CHAIN_LABEL.robinhood} to this address — anything else may be lost.`
                    : `Only send ${CASH_ASSET_BY_CHAIN[depositChain]} on ${CHAIN_LABEL[depositChain]} to this address — anything else may be lost.`}
                </Text>
              </>
            )}

            {withdrawStep === 'network' && (
              <>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Withdraw</Text>
                  <TouchableOpacity onPress={resetWithdraw} hitSlop={8}>
                    <Text style={styles.modalClose}>Close</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalSubtitle}>Choose a network to withdraw from.</Text>

                {CASH_SUPPORTED_CHAINS.map(chainKey => (
                  <TouchableOpacity
                    key={chainKey}
                    style={styles.networkRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      setWithdrawChain(chainKey);
                      setWithdrawStep('form');
                    }}>
                    <View style={styles.networkRowLeft}>
                      <NetworkIcon chainKey={chainKey} size={22} />
                      <Text style={styles.networkRowText}>{CHAIN_LABEL[chainKey]}</Text>
                    </View>
                    <Text style={styles.networkRowBalance}>${formatUsd(balanceForChain(chainKey))}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {withdrawStep === 'form' && withdrawChain && (
              <>
                <View style={styles.modalHeaderRow}>
                  <TouchableOpacity onPress={() => setWithdrawStep('network')} hitSlop={8}>
                    <ChevronLeftIcon color={colors.textPrimary} size={20} />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>{CHAIN_LABEL[withdrawChain]}</Text>
                  <View style={styles.modalHeaderSpacer} />
                </View>

                <Text style={styles.modalSectionLabel}>Recipient address</Text>
                <TextInput
                  style={styles.formInput}
                  value={withdrawAddress}
                  onChangeText={setWithdrawAddress}
                  placeholder={withdrawChain === 'solana' ? 'Solana address' : '0x…'}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={[styles.modalSectionLabel, styles.modalSectionLabelSpaced]}>Amount ({CASH_ASSET_BY_CHAIN[withdrawChain]})</Text>
                <View style={styles.amountRow}>
                  <TextInput
                    style={[styles.formInput, styles.amountInput]}
                    value={withdrawAmount}
                    onChangeText={setWithdrawAmount}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <TouchableOpacity style={styles.maxButton} onPress={() => setWithdrawAmount(String(withdrawChainBalance))} activeOpacity={0.7}>
                    <Text style={styles.maxButtonText}>Max</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.modalHint}>Available on {CHAIN_LABEL[withdrawChain]}: ${formatUsd(withdrawChainBalance)}</Text>

                <Text style={styles.modalWarning}>
                  Sends are final. Double-check the network and address — sending to the wrong network or address may
                  permanently lose funds.
                </Text>

                <TouchableOpacity
                  style={[styles.sendButton, !canSubmitWithdraw && styles.sendButtonDisabled]}
                  disabled={!canSubmitWithdraw}
                  onPress={handleConfirmWithdraw}
                  activeOpacity={0.8}>
                  <Text style={styles.sendButtonText}>Withdraw</Text>
                </TouchableOpacity>
              </>
            )}

            {withdrawStep === 'sending' && (
              <View style={styles.resultWrap}>
                <ActivityIndicator color={colors.textPrimary} size="large" />
                <Text style={styles.resultText}>Sending…</Text>
              </View>
            )}

            {withdrawStep === 'success' && (
              <View style={styles.resultWrap}>
                <Text style={styles.resultTitle}>Withdrawal sent</Text>
                <Text style={styles.resultText}>
                  {withdrawAmount} {withdrawChain ? CASH_ASSET_BY_CHAIN[withdrawChain] : 'USDC'} on {withdrawChain ? CHAIN_LABEL[withdrawChain] : ''}
                </Text>
                {withdrawTxId && (
                  <Text style={styles.modalAddress} selectable numberOfLines={1} ellipsizeMode="middle">
                    {withdrawTxId}
                  </Text>
                )}
                <TouchableOpacity style={styles.sendButton} onPress={resetWithdraw} activeOpacity={0.8}>
                  <Text style={styles.sendButtonText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}

            {withdrawStep === 'error' && (
              <View style={styles.resultWrap}>
                <Text style={styles.resultTitle}>Withdrawal failed</Text>
                <Text style={styles.modalWarning}>{withdrawError}</Text>
                <TouchableOpacity style={styles.sendButton} onPress={() => setWithdrawStep('form')} activeOpacity={0.8}>
                  <Text style={styles.sendButtonText}>Try again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={resetWithdraw}>
                  <Text style={styles.modalClose}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={bioEditing} animationType="slide" transparent onRequestClose={() => setBioEditing(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Bio</Text>
              <TouchableOpacity onPress={() => setBioEditing(false)} hitSlop={8}>
                <Text style={styles.modalClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.formInput, styles.bioInput]}
              value={bioDraft}
              onChangeText={setBioDraft}
              placeholder="Say something about yourself"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={160}
              autoFocus
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSaveBio} activeOpacity={0.8}>
              <Text style={styles.sendButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={usernameEditing} animationType="slide" transparent onRequestClose={() => setUsernameEditing(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Username</Text>
              <TouchableOpacity onPress={() => setUsernameEditing(false)} hitSlop={8}>
                <Text style={styles.modalClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.formInput}
              value={usernameDraft}
              onChangeText={text => {
                setUsernameDraft(text);
                setUsernameError('');
              }}
              placeholder="yourname"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              autoFocus
            />
            {usernameError ? (
              <Text style={styles.modalWarning}>{usernameError}</Text>
            ) : (
              <Text style={styles.modalHint}>3-20 characters. Letters, numbers, and underscore only — shown instead of your address.</Text>
            )}
            <TouchableOpacity style={styles.sendButton} onPress={handleSaveUsername} activeOpacity={0.8}>
              <Text style={styles.sendButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {session && (
        <ReferralModal
          visible={showReferral}
          onClose={() => setShowReferral(false)}
          address={session.evm.address}
          privateKeyHex={session.evm.privateKey}
        />
      )}

      <ConvertCashSheet
        visible={convertOpen}
        onClose={() => setConvertOpen(false)}
        session={session}
        cashPortfolio={cashPortfolio}
        onConverted={refreshCashPortfolio}
      />
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg},
    scrollContent: {paddingBottom: 32},

    headerIcons: {flexDirection: 'row', justifyContent: 'flex-end', gap: 18, paddingHorizontal: 16, paddingTop: 14},
    identityRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      marginTop: 8,
    },
    avatarWrap: {width: 84, height: 84},
    avatar: {
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: colors.ctaBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {color: colors.ctaText, fontSize: 30, fontWeight: '800'},
    avatarImage: {width: 84, height: 84, borderRadius: 42, backgroundColor: colors.panel},
    avatarEditButton: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.textPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.bg,
    },
    identityActions: {flexDirection: 'row', alignItems: 'center', gap: 8},
    shareButton: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
    },
    name: {color: colors.textPrimary, fontSize: 22, fontWeight: '800', marginTop: 14, paddingHorizontal: 16},
    handle: {color: colors.textMuted, fontSize: 14, marginTop: 2, paddingHorizontal: 16},
    addBio: {color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 8, paddingHorizontal: 16},
    bioText: {color: colors.textSecondary, fontSize: 13.5, lineHeight: 18, marginTop: 8, paddingHorizontal: 16},

    socialRow: {flexDirection: 'row', gap: 18, marginTop: 14, paddingHorizontal: 16},
    socialText: {color: colors.textMuted, fontSize: 13.5},
    socialCount: {color: colors.textPrimary, fontWeight: '700'},

    metaRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 12, paddingHorizontal: 16},
    metaItem: {flexDirection: 'row', alignItems: 'center', gap: 5},
    metaText: {color: colors.textMuted, fontSize: 12},

    divider: {height: 1, backgroundColor: colors.divider, marginTop: 18, marginHorizontal: 16},

    portfolioHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingHorizontal: 16,
      marginTop: 18,
    },
    portfolioValue: {color: colors.textPrimary, fontSize: 30, fontWeight: '700'},
    portfolioChange: {fontSize: 12.5, fontWeight: '600', marginTop: 2},
    portfolioChangePositive: {color: colors.gain},
    portfolioChangeNegative: {color: colors.danger},
    rangeRow: {flexDirection: 'row', gap: 4},
    rangePill: {paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999},
    rangePillActive: {backgroundColor: colors.pillBg},
    rangePillText: {color: colors.textMuted, fontSize: 12.5, fontWeight: '600'},
    rangePillTextActive: {color: colors.textPrimary, fontWeight: '700'},

    chartArea: {marginTop: 14, paddingHorizontal: 16, alignItems: 'center'},
    chartCaption: {color: colors.textMuted, fontSize: 11.5, marginTop: 8, textAlign: 'center'},

    totalCashRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      marginTop: 22,
    },
    totalCashLeft: {flexDirection: 'row', alignItems: 'center', gap: 12},
    totalCashIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.pillBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    totalCashIconText: {color: colors.textPrimary, fontSize: 16, fontWeight: '700'},
    totalCashLabel: {color: colors.textMuted, fontSize: 12.5},
    totalCashValue: {color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginTop: 2},
    totalCashSpinner: {alignSelf: 'flex-start', marginTop: 4},
    totalCashNote: {color: colors.warning, fontSize: 10, marginTop: 2},
    totalCashActions: {flexDirection: 'row', gap: 8},
    squareButton: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
    },

    positionsHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      marginTop: 26,
    },
    positionsHeading: {color: colors.textPrimary, fontSize: 18, fontWeight: '700'},
    segmented: {flexDirection: 'row', backgroundColor: colors.panel, borderRadius: 999, padding: 3, gap: 2},
    segment: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999},
    segmentActive: {backgroundColor: colors.ctaBg},
    segmentText: {color: colors.textMuted, fontSize: 12.5, fontWeight: '600'},
    segmentTextActive: {color: colors.ctaText, fontWeight: '700'},
    segmentDot: {width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.textMuted},
    segmentDotActive: {backgroundColor: colors.ctaText},

    assetFilterRow: {flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12},
    assetFilterPill: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
    },
    assetFilterPillActive: {backgroundColor: colors.ctaBg, borderColor: colors.ctaBg},
    assetFilterText: {color: colors.textSecondary, fontSize: 13, fontWeight: '600'},
    assetFilterTextActive: {color: colors.ctaText},

    emptyPositions: {color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 28},

    closedTradesList: {paddingHorizontal: 16, marginTop: 14, gap: 2},
    closedTradeRow: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider},
    closedTradeDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gain, flexShrink: 0},
    closedTradeDotSell: {backgroundColor: colors.danger},
    closedTradeMain: {flex: 1, minWidth: 0},
    closedTradeTitle: {color: colors.textPrimary, fontSize: 13.5, fontWeight: '700'},
    closedTradeSubtitle: {color: colors.textMuted, fontSize: 11.5, marginTop: 2},
    closedTradeWhen: {color: colors.textMuted, fontSize: 11, flexShrink: 0},

    showHiddenPill: {
      alignSelf: 'center',
      marginTop: 20,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
    },
    showHiddenText: {color: colors.textSecondary, fontSize: 12.5, fontWeight: '600'},

    modalBackdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)'},
    modalCard: {backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36},
    modalHeaderRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18},
    modalTitle: {color: colors.textPrimary, fontSize: 18, fontWeight: '800'},
    modalClose: {color: colors.textMuted, fontSize: 13, fontWeight: '600'},
    modalSectionLabel: {color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5},
    modalSectionLabelSpaced: {marginTop: 22},
    modalAddress: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 8,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    modalHint: {color: colors.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 8},
    modalWarning: {color: colors.danger, fontSize: 11.5, lineHeight: 16, marginTop: 10, fontWeight: '600'},
    modalSubtitle: {color: colors.textSecondary, fontSize: 13, marginBottom: 16},
    modalHeaderSpacer: {width: 20},

    networkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.panel,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 15,
      marginBottom: 8,
    },
    networkRowLeft: {flexDirection: 'row', alignItems: 'center', gap: 10},
    networkRowText: {color: colors.textPrimary, fontSize: 15, fontWeight: '700'},
    networkRowBalance: {color: colors.textMuted, fontSize: 13, fontWeight: '600'},

    formInput: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 8,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    bioInput: {minHeight: 90, textAlignVertical: 'top'},
    amountRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
    amountInput: {flex: 1},
    maxButton: {
      marginTop: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.pillBg,
    },
    maxButtonText: {color: colors.textPrimary, fontSize: 13, fontWeight: '700'},

    sendButton: {
      marginTop: 18,
      backgroundColor: colors.ctaBg,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
    },
    sendButtonDisabled: {opacity: 0.4},
    sendButtonText: {color: colors.ctaText, fontSize: 15, fontWeight: '700'},
    cancelButton: {marginTop: 12, alignItems: 'center'},

    resultWrap: {alignItems: 'center', paddingVertical: 20, gap: 10},
    resultTitle: {color: colors.textPrimary, fontSize: 17, fontWeight: '800'},
    resultText: {color: colors.textSecondary, fontSize: 13.5},
  });
}
