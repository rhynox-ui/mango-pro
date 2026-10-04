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
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Defs, LinearGradient, Line as SvgLine, Path as SvgPath, Stop} from 'react-native-svg';
import {
  ArrowUpIcon,
  BellIcon,
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
import {CHAIN_LABEL, MAINNET_CHAIN_IDS, NATIVE_SYMBOL, NEAR_ENABLED, NEAR_LABEL, assetDecimalsForChain, currencyAddress, type ChainKey} from '../core/chainData';
import {fetchCashPortfolio, spendableCash, CASH_ASSET_BY_CHAIN, CASH_SUPPORTED_CHAINS, type CashPortfolio} from '../core/usdcBalances';
import {fetchWalletNativeBalance, fetchWalletSolanaBalance} from '../wallet/walletRpc';
import {fetchWalletPrices} from '../core/walletPrices';
import {ConvertCashSheet} from '../components/ConvertCashSheet';
import {NetworkIcon} from '../wallet/NetworkIcon';
import {sendUsdc, isValidRecipientAddress} from '../wallet/sendUsdc';
import {addTxHistoryEntry, filterTxHistoryForAccount, getTxHistory, subscribeTxHistory} from '../wallet/txHistory';
import {getAvatarUri, getBio, getUsername, isValidUsername, setAvatarUri as saveAvatarUri, setBio as saveBio, setUsername as saveUsername} from '../wallet/profileLocal';
import {computePortfolioChange, filterHistoryByRange, getPortfolioHistory, recordPortfolioSnapshot, type PortfolioSnapshot} from '../wallet/portfolioHistory';
import {markOwnAction} from '../wallet/depositWatcher';
import {computeClosedPositions, computeOpenPositions, withLiveValues, type ClosedPosition, type OpenPositionWithValue} from '../wallet/openPositions';
import {hasUnseenNotifications, subscribeNotificationHistory} from '../notifications/notificationHistory';
import {AssetIcon} from '../components/AssetIcon';
import {privateKeyToAccount} from 'viem/accounts';
import {ReferralModal} from '../referral/ReferralModal';
import {getReferralStats, setReferralHandle, type ReferralSigner} from '../referral/referralApi';
import {signMessageViaParticle} from '../wallet/particleSigning';
import {loadGaslessTradingEnabled} from '../settings/gaslessTradingPrefs';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {useSession} from '../wallet/SessionContext';
import {fetchWalletAssets, type WalletAsset} from '../wallet/walletAssets';
import type {DemoToken} from './TokenTradeScreen';

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

/** A held token amount, not a $ amount — more decimals for a sub-$1 meme-token balance, trimmed trailing zeros so "5.2000" reads as "5.2". */
function formatTokenAmount(n: number): string {
  if (n === 0) return '0';
  const decimals = Math.abs(n) >= 1 ? 4 : 6;
  return n.toFixed(decimals).replace(/\.?0+$/, '');
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
type WithdrawStep = 'network' | 'form' | 'review' | 'sending' | 'success' | 'error';

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
  onOpenNotifications,
  onOpenToken,
  pendingAction,
  onPendingActionHandled,
}: {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onOpenNotifications: () => void;
  /** Tapping a position (Open or Closed) — hands the token straight to the Trade screen, same shape HomeScreen/SearchScreen already use to get there. */
  onOpenToken?: (token: DemoToken) => void;
  /** Set by App.tsx when navigation here should also open a specific action (e.g. Settings' "Deposit and Withdraw" row, or Home's own Deposit button) — consumed once below, not a persistent mode. */
  pendingAction?: 'withdraw' | 'deposit' | null;
  onPendingActionHandled?: () => void;
}) {
  const {colors} = useTheme();
  const {session} = useSession();
  const styles = makeStyles(colors);
  // This screen's Deposit/Withdraw/bio/username modals use a plain RN
  // Modal (not components/BottomSheet.tsx, which already solves this
  // same problem) with a static paddingBottom — that padding sits BEHIND
  // a phone's bottom gesture bar/home indicator rather than clearing it,
  // so the primary action button (e.g. Withdraw) could render partly
  // underneath it. Added below at each modalCard usage rather than
  // baked into the StyleSheet, since StyleSheet.create can't read a
  // hook value.
  const insets = useSafeAreaInsets();
  const [depositStep, setDepositStep] = useState<DepositStep | null>(null);
  // 'near' sits beside the ChainKeys: NEAR isn't a Relay chain (chainData.ts's NEAR note).
  const [depositChain, setDepositChain] = useState<ChainKey | 'near' | null>(null);
  const depositLabel = depositChain === 'near' ? NEAR_LABEL : depositChain ? CHAIN_LABEL[depositChain] : '';
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
  // Same Security-screen opt-in every other trade path already reads
  // (gaslessTradingPrefs.ts, defaults to true) — lets a crypto Withdraw
  // sponsor its own EVM gas the same way Convert now does.
  const [gaslessTradingEnabled, setGaslessTradingEnabled] = useState(false);
  useEffect(() => {
    loadGaslessTradingEnabled().then(setGaslessTradingEnabled);
  }, []);
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
  // Username shown up top. Once set, this replaces the raw address as
  // the identity shown here (a real user-chosen handle beats a hex
  // string), and the address itself drops out of that spot — it's still
  // real and still shown in full in the Deposit modal, so nothing is
  // actually hidden, just not repeated where a username now does that
  // job.
  //
  // Every wallet's username IS its real referral handle — the same
  // server-verified, unique, immutable-once-set identity ReferralModal's
  // own "Referral & points" claim flow uses, same one shared identity
  // mango-mobile's own referral system already is, rather than a second,
  // disconnected local-only concept that could silently show something
  // different from the handle your invite link actually uses.
  // referralHandle wins the moment it resolves and gets mirrored into
  // local storage so it's what's shown instantly on next launch too,
  // before this fetch has had a chance to run. A seed-phrase wallet
  // signs the claim locally (viem); a Google/Particle session signs
  // through signMessageViaParticle (particleSigning.ts) — same claim
  // either way, see handleSaveUsername below.
  const [username, setUsernameValue] = useState('');
  const [referralHandle, setReferralHandleValue] = useState<string | null>(null);
  const [showReferral, setShowReferral] = useState(false);
  const [usernameEditing, setUsernameEditing] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameSaving, setUsernameSaving] = useState(false);
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
    getReferralStats(address)
      .then(stats => {
        if (cancelled || !stats.handle) return;
        setReferralHandleValue(stats.handle);
        setUsernameValue(stats.handle);
        saveUsername(address, stats.handle);
      })
      .catch(() => {});
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
    // A claimed referral handle is permanent server-side (one per
    // wallet, ReferralModal's own claim flow already says so) — nothing
    // here can un-set or replace it, so there's nothing to edit once
    // one exists.
    if (referralHandle) return;
    setUsernameDraft(username);
    setUsernameError('');
    setUsernameEditing(true);
  }

  async function handleSaveUsername() {
    if (!session || referralHandle) return;
    const trimmed = usernameDraft.trim();
    if (trimmed && !isValidUsername(trimmed)) {
      setUsernameError('3-20 characters, starting with a letter — letters, numbers, and underscore only.');
      return;
    }
    if (trimmed) {
      // Real, one-time, server-signed claim — the same referral handle
      // ReferralModal's own "Referral & points" claim flow sets, so
      // setting a username HERE is claiming that same one identity, not
      // filling in a second, disconnected local field. isValidUsername's
      // pattern (must start with a letter) is a strict subset of the
      // handle's own server-side shape, so anything that passes it here
      // is always accepted there too. Works for every wallet type now —
      // a seed-phrase wallet signs locally via viem, a Google/Particle
      // session signs through signMessageViaParticle (particleSigning.ts).
      const canSignLocally = session.evm.privateKey.length > 0;
      const sign: ReferralSigner = message =>
        canSignLocally ? privateKeyToAccount(session.evm.privateKey as `0x${string}`).signMessage({message}) : signMessageViaParticle(message);
      setUsernameSaving(true);
      setUsernameError('');
      try {
        const {handle} = await setReferralHandle({address: session.evm.address, handle: trimmed, sign});
        setReferralHandleValue(handle);
        setUsernameValue(handle);
        await saveUsername(session.evm.address, handle);
        setUsernameEditing(false);
      } catch (err) {
        setUsernameError(err instanceof Error ? err.message : 'Could not claim that username right now.');
      } finally {
        setUsernameSaving(false);
      }
      return;
    }
    // Clearing back to no username at all: the local-only fallback, same as before.
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
  // positions are real too now (openPositions.ts) — net held amount per
  // token, derived from this same trade history, priced live via
  // DexScreener.
  const [tradeCount, setTradeCount] = useState(0);
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[]>([]);
  const [openPositions, setOpenPositions] = useState<OpenPositionWithValue[]>([]);
  const [nativePositions, setNativePositions] = useState<OpenPositionWithValue[]>([]);
  const [walletAssets, setWalletAssets] = useState<WalletAsset[]>([]);
  const [walletAssetsComplete, setWalletAssetsComplete] = useState(true);
  const [walletAssetsLoading, setWalletAssetsLoading] = useState(false);

  // Live wallet index: anything with a positive fungible balance appears
  // here even when it never touched Mango before. txHistory remains the
  // fallback for older positions if an upstream indexer is partial.
  useEffect(() => {
    if (!session) {
      setWalletAssets([]);
      setWalletAssetsComplete(true);
      return;
    }
    let cancelled = false;
    setWalletAssetsLoading(true);
    fetchWalletAssets(session.evm.address, session.solana.address)
      .then(result => {
        if (cancelled) return;
        setWalletAssets(result.holdings);
        setWalletAssetsComplete(result.complete);
      })
      .catch(() => {
        if (cancelled) return;
        setWalletAssetsComplete(false);
      })
      .finally(() => {
        if (!cancelled) setWalletAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const displayWalletAssets = useMemo(() => {
    const byKey = new Map<string, WalletAsset>();
    for (const asset of walletAssets) byKey.set(asset.key, asset);
    for (const position of openPositions) {
      // NEAR uses a separate trade path and is not part of the indexed EVM/Solana asset set yet.
      if (position.chainKey === 'near') continue;
      const key = `${position.chainKey}:${position.tokenAddress}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          chainKey: position.chainKey,
          address: position.tokenAddress,
          symbol: position.symbol,
          name: position.symbol,
          decimals: 18,
          amount: position.amountHeld,
          valueUsd: position.valueUsd,
          priceUsd: position.valueUsd != null && position.amountHeld > 0 ? position.valueUsd / position.amountHeld : null,
          imageUrl: position.imageUrl,
          isNative: false,
        });
      }
    }
    return [...byKey.values()].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  }, [walletAssets, openPositions]);


  useEffect(() => {
    function recount(entries: ReturnType<typeof getTxHistory>) {
      const scoped = session ? filterTxHistoryForAccount(entries, {evmAddress: session.evm.address, solanaAddress: session.solana.address, nearAddress: session.near?.address}) : entries;
      const successful = scoped.filter(e => e.status === 'success');
      setTradeCount(successful.length);
      // "Closed" is a token fully sold back out (net ~0), one row per
      // token — not one row per trade (see openPositions.ts's own
      // header for why five round-trip trades on the same token used
      // to render as five separate rows here).
      setClosedPositions(computeClosedPositions(successful));
      // Synchronous amounts first (so the list appears immediately with
      // real held amounts), then the same positions re-rendered with
      // live $ values once DexScreener resolves — never blocks showing
      // what's actually held on a price lookup.
      const positions = computeOpenPositions(successful);
      setOpenPositions(positions.map(p => ({...p, valueUsd: null})));
      withLiveValues(positions).then(setOpenPositions);
    }
    recount(getTxHistory());
    return subscribeTxHistory(recount);
  }, [session]);

  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(() => hasUnseenNotifications());
  useEffect(() => subscribeNotificationHistory(() => setHasUnreadNotifications(hasUnseenNotifications())), []);

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
    // Both real call sites of this function (Convert's onConverted,
    // Withdraw's own success branch below) are this app moving its own
    // money — mark that BEFORE the fetch resolves so App.tsx's
    // depositWatcher poll (which runs independently, every 60s) never
    // mistakes the resulting balance change for an external deposit.
    markOwnAction(session.evm.address);
    // forceFresh: this fires after a real balance change (a completed
    // Convert) or a deliberate pull-to-refresh — the whole point is a
    // genuinely current number, so this is the one caller that must
    // bypass fetchCashPortfolio's own short-lived cache rather than
    // risk replaying a stale pre-Convert total.
    fetchCashPortfolio(session, {forceFresh: true}).then(portfolio => {
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
    const symbol = CASH_ASSET_BY_CHAIN[withdrawChain] ?? 'USDC';
    const fromAddress = withdrawChain === 'solana' ? session.solana.address : session.evm.address;
    try {
      const {txId} = await sendUsdc(withdrawChain, session, withdrawAddress.trim(), withdrawAmount, symbol, gaslessTradingEnabled);
      setWithdrawTxId(txId);
      setWithdrawStep('success');
      // Real gap this closes: a successful withdrawal broadcast fine but
      // was never recorded here — Convert's own addTxHistoryEntry call
      // right after execution was the only reason its own history worked
      // at all; this one was simply missing, so a completed withdrawal
      // could disappear from Mango's own History screen even though it
      // landed on-chain.
      addTxHistoryEntry({
        status: 'success',
        chainKey: withdrawChain,
        chainLabel: CHAIN_LABEL[withdrawChain],
        isBuySide: false,
        kind: 'withdrawal',
        paySymbol: symbol,
        receiveSymbol: symbol,
        payAmount: withdrawAmount,
        receivedAmountFormatted: null,
        hashes: [txId],
        fromAddress,
      });
      refreshCashPortfolio();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The send failed. Nothing left this wallet.';
      setWithdrawError(message);
      setWithdrawStep('error');
      addTxHistoryEntry({
        status: 'error',
        chainKey: withdrawChain,
        chainLabel: CHAIN_LABEL[withdrawChain],
        isBuySide: false,
        kind: 'withdrawal',
        paySymbol: symbol,
        receiveSymbol: symbol,
        payAmount: withdrawAmount,
        receivedAmountFormatted: null,
        hashes: [],
        errorMessage: message,
        fromAddress,
      });
    }
  }

  const withdrawAmountNumber = Number(withdrawAmount);
  // Spendable, so a MAX withdraw on Arc leaves the USDC its gas is paid in.
  const withdrawChainBalance = withdrawChain ? spendableCash(withdrawChain, balanceForChain(withdrawChain)) : 0;
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
          <TouchableOpacity style={styles.shareButton} hitSlop={6} onPress={onOpenNotifications}>
            <BellIcon color={colors.textPrimary} size={15} />
            {hasUnreadNotifications && <View style={styles.bellDot} />}
          </TouchableOpacity>
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
      {positionTab === 'Open' && assetFilter !== 'Perps' ? (
        <View style={styles.closedTradesList}>
          {walletAssetsLoading && displayWalletAssets.length === 0 ? (
            <View style={styles.emptyPositionsBox}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <Text style={styles.emptyPositionsText}>Loading wallet assets…</Text>
            </View>
          ) : displayWalletAssets.length > 0 ? (
            displayWalletAssets.map(asset => (
              <TouchableOpacity
                key={asset.key}
                style={styles.closedTradeRow}
                activeOpacity={0.6}
                disabled={!onOpenToken}
                onPress={() => onOpenToken?.({
                  chainKey: asset.chainKey,
                  address: asset.address,
                  symbol: asset.symbol,
                  imageUrl: asset.imageUrl,
                })}>
                {asset.isNative ? (
                  <NetworkIcon chainKey={asset.chainKey} size={30} />
                ) : (
                  <AssetIcon symbol={asset.symbol} imageUrl={asset.imageUrl} size={30} />
                )}
                <View style={styles.closedTradeMain}>
                  <Text style={styles.closedTradeTitle} numberOfLines={1}>{asset.symbol}</Text>
                  <Text style={styles.closedTradeSubtitle} numberOfLines={1}>
                    {formatTokenAmount(asset.amount)} {asset.symbol} · {CHAIN_LABEL[asset.chainKey]}
                  </Text>
                </View>
                <View style={styles.closedTradeRight}>
                  <Text style={styles.closedTradeTitle}>
                    {asset.valueUsd != null ? `$${formatUsd(asset.valueUsd)}` : '—'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyPositions}>
              <Text style={styles.emptyPositionsText}>No wallet assets</Text>
              <Text style={styles.emptyPositionsHint}>Balances received outside Mango will appear here automatically.</Text>
            </View>
          )}
          {!walletAssetsComplete && displayWalletAssets.length > 0 ? (
            <Text style={styles.emptyPositionsHint}>Some wallet assets could not be verified right now.</Text>
          ) : null}
        </View>
      ) : positionTab === 'Closed' && assetFilter !== 'Perps' && closedPositions.length > 0 ? (
        <View style={styles.closedTradesList}>
          {/* One row per fully-exited TOKEN (computeClosedPositions
              aggregates every Buy/Sell down to a net ~0 amount), not one
              row per trade — matches the Open tab's own per-token shape
              instead of showing a raw, unfiltered trade log here. */}
          {closedPositions.map(position => (
            <TouchableOpacity
              key={position.key}
              style={styles.closedTradeRow}
              activeOpacity={0.6}
              disabled={!onOpenToken}
              onPress={() => onOpenToken?.({chainKey: position.chainKey, address: position.tokenAddress, symbol: position.symbol, imageUrl: position.imageUrl})}>
              <AssetIcon symbol={position.symbol} imageUrl={position.imageUrl} size={30} />
              <View style={styles.closedTradeMain}>
                <Text style={styles.closedTradeTitle} numberOfLines={1}>
                  {position.symbol}
                </Text>
                <Text style={styles.closedTradeSubtitle} numberOfLines={1}>
                  Fully sold on {position.chainLabel}
                </Text>
              </View>
              <View style={styles.closedTradeRight}>
                <Text style={styles.closedTradeWhen}>{formatWhen(position.lastTradeAt)}</Text>
              </View>
            </TouchableOpacity>
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
          <View style={[styles.modalCard, {paddingBottom: 36 + insets.bottom}]}>
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

                {/* USDC on NEAR — the same row, for the wallet's own NEAR account. */}
                {NEAR_ENABLED && session?.near && (
                  <TouchableOpacity
                    style={styles.networkRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      setDepositChain('near');
                      setDepositIsNativeGas(false);
                      setDepositStep('address');
                    }}>
                    <View style={styles.networkRowLeft}>
                      <NetworkIcon chainKey="near" size={22} />
                      <Text style={styles.networkRowText}>{NEAR_LABEL}</Text>
                    </View>
                    <ChevronRightIcon color={colors.textMuted} size={16} />
                  </TouchableOpacity>
                )}

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
                  <Text style={styles.modalTitle}>{depositLabel}</Text>
                  <View style={styles.modalHeaderSpacer} />
                </View>

                <Text style={styles.modalSectionLabel}>Your {depositLabel} address</Text>
                <Text style={styles.modalAddress} selectable numberOfLines={1} ellipsizeMode="middle">
                  {depositChain === 'near' ? (session?.near?.address ?? '—') : depositChain === 'solana' ? (session?.solana.address ?? '—') : (session?.evm.address ?? '—')}
                </Text>
                <Text style={styles.modalHint}>
                  {depositChain === 'near'
                    ? 'Your NEAR account, from the same recovery phrase — it also opens in any NEAR wallet (HOT, Meteor, MyNearWallet).'
                    : depositChain === 'solana'
                    ? "A separate address — Solana isn't an EVM chain, so it can't share the address other networks use."
                    : depositIsNativeGas
                      ? 'The same address as every other EVM network here — this deposit is for gas specifically, separate from the USDG row above.'
                      : `The same address also works on: ${EVM_CASH_CHAINS.filter(c => c !== depositChain)
                          .map(c => CHAIN_LABEL[c])
                          .join(', ')}.`}
                </Text>
                <Text style={styles.modalWarning}>
                  {depositChain === 'near'
                    ? `Only send USDC on ${NEAR_LABEL} (Circle's native USDC) to this address — anything else may be lost.`
                    : depositIsNativeGas
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

                {/* Real fix for a real, reported symptom: the button below
                    silently disables (opacity 0.4) the moment any one of
                    canSubmitWithdraw's four conditions isn't met, with
                    nothing explaining which one — reads as "the UI is
                    static/broken" rather than "fill in a valid amount"
                    when the dimming alone doesn't register as an
                    explanation. Only one reason is ever shown at a time,
                    in the same priority order canSubmitWithdraw checks
                    them, and only once the recipient field has real
                    content — an empty field on first open needs no
                    address-format complaint yet. */}
                {!canSubmitWithdraw && withdrawAddress.trim().length > 0 && !isValidRecipientAddress(withdrawChain, withdrawAddress.trim()) && (
                  <Text style={styles.withdrawDisabledReason}>That doesn't look like a valid {withdrawChain === 'solana' ? 'Solana' : 'wallet'} address.</Text>
                )}
                {!canSubmitWithdraw && (withdrawAddress.trim().length === 0 || isValidRecipientAddress(withdrawChain, withdrawAddress.trim())) && withdrawAmountNumber <= 0 && (
                  <Text style={styles.withdrawDisabledReason}>Enter an amount to withdraw.</Text>
                )}
                {!canSubmitWithdraw && isValidRecipientAddress(withdrawChain, withdrawAddress.trim()) && withdrawAmountNumber > 0 && withdrawAmountNumber > withdrawChainBalance && (
                  <Text style={styles.withdrawDisabledReason}>
                    That's more than the ${formatUsd(withdrawChainBalance)} available on {CHAIN_LABEL[withdrawChain]}.
                  </Text>
                )}

                <TouchableOpacity
                  style={[styles.sendButton, !canSubmitWithdraw && styles.sendButtonDisabled]}
                  disabled={!canSubmitWithdraw}
                  onPress={() => setWithdrawStep('review')}
                  activeOpacity={0.8}>
                  <Text style={styles.sendButtonText}>Review withdrawal</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Real gap this closes: this modal used to go straight from
                the form to broadcasting on one tap — no screen showing
                network/asset/amount/recipient together before a
                withdrawal (final, on-chain, no undo) actually goes out.
                Adds nothing to the send path itself: handleConfirmWithdraw
                below is the exact same function the form's own button
                used to call directly. */}
            {withdrawStep === 'review' && withdrawChain && (
              <>
                <View style={styles.modalHeaderRow}>
                  <TouchableOpacity onPress={() => setWithdrawStep('form')} hitSlop={8}>
                    <ChevronLeftIcon color={colors.textPrimary} size={20} />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>Review withdrawal</Text>
                  <View style={styles.modalHeaderSpacer} />
                </View>

                <View style={styles.reviewRow}>
                  <Text style={styles.reviewRowLabel}>Network</Text>
                  <Text style={styles.reviewRowValue}>{CHAIN_LABEL[withdrawChain]}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewRowLabel}>Asset</Text>
                  <Text style={styles.reviewRowValue}>{CASH_ASSET_BY_CHAIN[withdrawChain] ?? 'USDC'}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewRowLabel}>Amount</Text>
                  <Text style={styles.reviewRowValue}>
                    {withdrawAmount} {CASH_ASSET_BY_CHAIN[withdrawChain] ?? 'USDC'}
                  </Text>
                </View>
                <View style={styles.reviewAddressBlock}>
                  <Text style={styles.reviewRowLabel}>To</Text>
                  <Text style={styles.reviewAddressValue}>{withdrawAddress.trim()}</Text>
                </View>

                <Text style={styles.modalWarning}>Sends are final. Double-check the network and address above — sending to the wrong network or address may permanently lose funds.</Text>

                <TouchableOpacity style={styles.sendButton} onPress={handleConfirmWithdraw} activeOpacity={0.8}>
                  <Text style={styles.sendButtonText}>Confirm withdrawal</Text>
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
          <View style={[styles.modalCard, {paddingBottom: 36 + insets.bottom}]}>
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
          <View style={[styles.modalCard, {paddingBottom: 36 + insets.bottom}]}>
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
              <Text style={styles.modalHint}>
                3-20 characters. Letters, numbers, and underscore only — shown instead of your address. This also claims your referral handle —
                one per wallet, permanent once set.
              </Text>
            )}
            <TouchableOpacity
              style={[styles.sendButton, usernameSaving && styles.sendButtonDisabled]}
              onPress={handleSaveUsername}
              disabled={usernameSaving}
              activeOpacity={0.8}>
              {usernameSaving ? <ActivityIndicator color={colors.ctaText} /> : <Text style={styles.sendButtonText}>Save</Text>}
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
    bellDot: {
      position: 'absolute',
      top: 7,
      right: 7,
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: colors.danger,
      borderWidth: 1.5,
      borderColor: colors.panel,
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
    emptyPositionsBox: {alignItems: 'center', justifyContent: 'center', paddingVertical: 28, paddingHorizontal: 20},
    emptyPositionsText: {color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8},
    emptyPositionsHint: {color: colors.textMuted, fontSize: 11.5, textAlign: 'center', marginTop: 6},

    closedTradesList: {paddingHorizontal: 16, marginTop: 14, gap: 2},
    closedTradeRow: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider},
    closedTradeMain: {flex: 1, minWidth: 0},
    closedTradeTitle: {color: colors.textPrimary, fontSize: 13.5, fontWeight: '700'},
    closedTradeSubtitle: {color: colors.textMuted, fontSize: 11.5, marginTop: 2},
    closedTradeRight: {alignItems: 'flex-end', flexShrink: 0, gap: 2},
    closedTradeWhen: {color: colors.textMuted, fontSize: 11},

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
    // paddingBottom is applied inline at each usage (36 + the device's
    // bottom safe-area inset) — not here, since StyleSheet.create has no
    // access to useSafeAreaInsets()'s value. See its own comment above.
    modalCard: {backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20},
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
    withdrawDisabledReason: {color: colors.danger, fontSize: 12, lineHeight: 16, marginTop: 10},
    modalSubtitle: {color: colors.textSecondary, fontSize: 13, marginBottom: 16},
    modalHeaderSpacer: {width: 20},
    reviewRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider},
    reviewRowLabel: {color: colors.textMuted, fontSize: 13, fontWeight: '600'},
    reviewRowValue: {color: colors.textPrimary, fontSize: 14, fontWeight: '700'},
    reviewAddressBlock: {marginTop: 14},
    reviewAddressValue: {color: colors.textPrimary, fontSize: 13, fontWeight: '600', marginTop: 8, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12},

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
