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
import {ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Svg, {Line as SvgLine} from 'react-native-svg';
import {
  AlertCircleIcon,
  ArrowUpIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  GearIcon,
  GiftIcon,
  GridIcon,
  HistoryIcon,
  LandmarkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  UploadIcon,
} from '../components/icons';
import {CHAIN_LABEL, type ChainKey} from '../core/chainData';
import {fetchUsdcPortfolio, USDC_SUPPORTED_CHAINS, type UsdcPortfolio} from '../core/usdcBalances';
import {sendUsdc, isValidRecipientAddress} from '../wallet/sendUsdc';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {useSession} from '../wallet/SessionContext';

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

// Every USDC chain except Solana shares the SAME EVM address — this is
// what "deposit on whichever chain works for you" actually reduces to
// for a user: one address, valid everywhere in this list, plus a
// separate Solana address for the one non-EVM chain.
const EVM_USDC_CHAINS = USDC_SUPPORTED_CHAINS.filter(c => c !== 'solana');

// Mirrors FOMO's own deposit flow shape (methods -> pick a network ->
// show the address for that one network) — adapted to what this app can
// actually do today: Crypto is real, Debit/Bank/Exchanges are shown
// (same as the reference) but marked "Coming soon" rather than faked,
// since no fiat on/off-ramp integration exists yet.
type DepositStep = 'methods' | 'network' | 'address';

// Mirrors FOMO's own "Choose withdraw method" screen shape, same
// real-vs-"Coming soon" split as Deposit: Crypto wallet is real (this
// app's non-custodial sendUsdc.ts), bank/finance-app withdrawal (fiat
// off-ramp) has no integration yet.
type WithdrawStep = 'methods' | 'network' | 'form' | 'sending' | 'success' | 'error';

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

export function ProfileScreen({onOpenSettings}: {onOpenSettings: () => void}) {
  const {colors} = useTheme();
  const {session} = useSession();
  const styles = makeStyles(colors);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [depositStep, setDepositStep] = useState<DepositStep | null>(null);
  const [depositChain, setDepositChain] = useState<ChainKey | null>(null);
  const [withdrawStep, setWithdrawStep] = useState<WithdrawStep | null>(null);
  const [withdrawChain, setWithdrawChain] = useState<ChainKey | null>(null);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawTxId, setWithdrawTxId] = useState<string | null>(null);
  const [usdcPortfolio, setUsdcPortfolio] = useState<UsdcPortfolio | null>(null);
  const [usdcLoading, setUsdcLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [positionTab, setPositionTab] = useState<PositionTab>('Open');
  const [assetFilter, setAssetFilter] = useState<AssetFilterKey>('All');
  const joined = useMemo(joinedLabel, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setUsdcLoading(true);
    fetchUsdcPortfolio(session).then(portfolio => {
      if (cancelled) return;
      setUsdcPortfolio(portfolio);
      setUsdcLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  function refreshUsdcPortfolio() {
    if (!session) return;
    fetchUsdcPortfolio(session).then(setUsdcPortfolio);
  }

  function balanceForChain(chainKey: ChainKey | null): number {
    if (!chainKey || !usdcPortfolio) return 0;
    const result = usdcPortfolio.results.find(r => r.chainKey === chainKey);
    return result?.status === 'ok' ? result.balance : 0;
  }

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
      const {txId} = await sendUsdc(withdrawChain, session, withdrawAddress.trim(), withdrawAmount);
      setWithdrawTxId(txId);
      setWithdrawStep('success');
      refreshUsdcPortfolio();
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
      <TouchableOpacity style={styles.banner} onPress={() => setBannerOpen(v => !v)} activeOpacity={0.7}>
        <AlertCircleIcon color={colors.warning} size={17} />
        <Text style={styles.bannerText} numberOfLines={1}>
          Elevated network fees on {CHAIN_LABEL.robinhood}.
        </Text>
        <ChevronDownIcon color={colors.textMuted} size={15} />
      </TouchableOpacity>
      {bannerOpen && (
        <View style={styles.bannerDetail}>
          <Text style={styles.bannerDetailText}>
            Network conditions on {CHAIN_LABEL.robinhood} are temporarily driving gas costs higher than usual — trades still
            go through, just at a higher fee than normal.
          </Text>
        </View>
      )}

      <View style={styles.headerIcons}>
        <TouchableOpacity hitSlop={8}>
          <HistoryIcon color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity hitSlop={8} onPress={onOpenSettings}>
          <GearIcon color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.identityRow}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>Y</Text>
          </View>
          <TouchableOpacity style={styles.avatarEditButton} hitSlop={6}>
            <PencilIcon color={colors.bg} size={11} />
          </TouchableOpacity>
        </View>
        <View style={styles.identityActions}>
          <TouchableOpacity style={styles.shareButton} hitSlop={6}>
            <UploadIcon color={colors.textPrimary} size={15} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.rewardsButton} activeOpacity={0.85}>
            <GiftIcon color={colors.ctaText} size={15} />
            <Text style={styles.rewardsButtonText}>Rewards</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.name}>Your Profile</Text>
      {/* Real, from the unlocked wallet's own EVM account — no username
          system exists yet, so the address is the identity shown until
          one does. */}
      <Text style={styles.handle}>{session ? truncateAddress(session.evm.address) : '—'}</Text>
      <TouchableOpacity>
        <Text style={styles.addBio}>+ Add a bio</Text>
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
          <Text style={styles.metaText}>0 trades</Text>
        </View>
        <View style={styles.metaItem}>
          <CalendarIcon color={colors.textMuted} size={13} />
          <Text style={styles.metaText}>{joined}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.portfolioHeader}>
        <View>
          <Text style={styles.portfolioValue}>$0.00</Text>
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
        <Svg width="100%" height={90} viewBox="0 0 300 90" preserveAspectRatio="none">
          <SvgLine x1="0" y1="45" x2="300" y2="45" stroke={colors.panelBorder} strokeWidth={2} />
        </Svg>
        <Text style={styles.chartCaption}>No portfolio history yet — trade to start your chart.</Text>
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
              <Text style={styles.totalCashValue}>${usdcPortfolio ? formatUsd(usdcPortfolio.totalUsd) : '0.00'}</Text>
            )}
            {usdcPortfolio && !usdcPortfolio.complete && (
              <Text style={styles.totalCashNote}>Some chains didn't respond — this may be incomplete.</Text>
            )}
          </View>
        </View>
        <View style={styles.totalCashActions}>
          <TouchableOpacity style={styles.squareButton} hitSlop={4} onPress={() => setDepositStep('methods')}>
            <PlusIcon color={colors.textPrimary} size={16} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.squareButton} hitSlop={4}>
            <MoreHorizontalIcon color={colors.textPrimary} size={16} />
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

      <Text style={styles.emptyPositions}>
        {positionTab === 'Open' ? 'No open positions' : 'No closed positions yet'}
      </Text>

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
            {depositStep === 'methods' && (
              <>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Deposit with</Text>
                  <TouchableOpacity onPress={() => setDepositStep(null)} hitSlop={8}>
                    <Text style={styles.modalClose}>Close</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.depositMethodRow} activeOpacity={0.7} onPress={() => setDepositStep('network')}>
                  <View style={styles.depositMethodText}>
                    <Text style={styles.depositMethodTitle}>Crypto</Text>
                    <Text style={styles.depositMethodSubtitle}>Receive USDC from a crypto wallet</Text>
                  </View>
                  <DownloadIcon color={colors.textPrimary} size={20} />
                </TouchableOpacity>

                <View style={[styles.depositMethodRow, styles.depositMethodDisabled]}>
                  <View style={styles.depositMethodText}>
                    <View style={styles.depositMethodTitleRow}>
                      <Text style={styles.depositMethodTitle}>Debit or bank</Text>
                      <View style={styles.comingSoonPill}>
                        <Text style={styles.comingSoonText}>Coming soon</Text>
                      </View>
                    </View>
                    <Text style={styles.depositMethodSubtitle}>Deposit cash with a debit card or bank transfer</Text>
                  </View>
                  <LandmarkIcon color={colors.textMuted} size={20} />
                </View>

                <View style={[styles.depositMethodRow, styles.depositMethodDisabled]}>
                  <View style={styles.depositMethodText}>
                    <View style={styles.depositMethodTitleRow}>
                      <Text style={styles.depositMethodTitle}>Exchanges and apps</Text>
                      <View style={styles.comingSoonPill}>
                        <Text style={styles.comingSoonText}>Coming soon</Text>
                      </View>
                    </View>
                    <Text style={styles.depositMethodSubtitle}>Cash App, Coinbase, and similar</Text>
                  </View>
                  <GridIcon color={colors.textMuted} size={20} />
                </View>
              </>
            )}

            {depositStep === 'network' && (
              <>
                <View style={styles.modalHeaderRow}>
                  <TouchableOpacity onPress={() => setDepositStep('methods')} hitSlop={8}>
                    <ChevronLeftIcon color={colors.textPrimary} size={20} />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>Deposit crypto</Text>
                  <View style={styles.modalHeaderSpacer} />
                </View>
                <Text style={styles.modalSubtitle}>Choose a network to deposit from.</Text>

                {USDC_SUPPORTED_CHAINS.map(chainKey => (
                  <TouchableOpacity
                    key={chainKey}
                    style={styles.networkRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      setDepositChain(chainKey);
                      setDepositStep('address');
                    }}>
                    <Text style={styles.networkRowText}>{CHAIN_LABEL[chainKey]}</Text>
                    <ChevronRightIcon color={colors.textMuted} size={16} />
                  </TouchableOpacity>
                ))}
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
                    : `The same address also works on: ${EVM_USDC_CHAINS.filter(c => c !== depositChain)
                        .map(c => CHAIN_LABEL[c])
                        .join(', ')}.`}
                </Text>
                <Text style={styles.modalWarning}>Only send USDC on {CHAIN_LABEL[depositChain]} to this address — anything else may be lost.</Text>
              </>
            )}

            {depositStep === 'methods' && (
              <TouchableOpacity style={styles.withdrawRow} activeOpacity={0.7} onPress={() => setWithdrawStep('methods')}>
                <ArrowUpIcon color={colors.textMuted} size={16} />
                <Text style={styles.withdrawText}>Withdraw</Text>
              </TouchableOpacity>
            )}

            {withdrawStep === 'methods' && (
              <>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Choose withdraw method</Text>
                  <TouchableOpacity onPress={resetWithdraw} hitSlop={8}>
                    <Text style={styles.modalClose}>Close</Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.depositMethodRow, styles.depositMethodDisabled]}>
                  <View style={styles.depositMethodText}>
                    <View style={styles.depositMethodTitleRow}>
                      <Text style={styles.depositMethodTitle}>Bank account (US only)</Text>
                      <View style={styles.comingSoonPill}>
                        <Text style={styles.comingSoonText}>Coming soon</Text>
                      </View>
                    </View>
                    <Text style={styles.depositMethodSubtitle}>Withdraw US dollars via ACH</Text>
                  </View>
                  <LandmarkIcon color={colors.textMuted} size={20} />
                </View>

                <TouchableOpacity style={styles.depositMethodRow} activeOpacity={0.7} onPress={() => setWithdrawStep('network')}>
                  <View style={styles.depositMethodText}>
                    <Text style={styles.depositMethodTitle}>Crypto wallet</Text>
                    <Text style={styles.depositMethodSubtitle}>Withdraw USDC to a supported network</Text>
                  </View>
                  <ArrowUpIcon color={colors.textPrimary} size={20} />
                </TouchableOpacity>

                <View style={[styles.depositMethodRow, styles.depositMethodDisabled]}>
                  <View style={styles.depositMethodText}>
                    <View style={styles.depositMethodTitleRow}>
                      <Text style={styles.depositMethodTitle}>Finance apps</Text>
                      <View style={styles.comingSoonPill}>
                        <Text style={styles.comingSoonText}>Coming soon</Text>
                      </View>
                    </View>
                    <Text style={styles.depositMethodSubtitle}>Cash App, Coinbase, and similar</Text>
                  </View>
                  <GridIcon color={colors.textMuted} size={20} />
                </View>
              </>
            )}

            {withdrawStep === 'network' && (
              <>
                <View style={styles.modalHeaderRow}>
                  <TouchableOpacity onPress={() => setWithdrawStep('methods')} hitSlop={8}>
                    <ChevronLeftIcon color={colors.textPrimary} size={20} />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>Withdraw crypto</Text>
                  <View style={styles.modalHeaderSpacer} />
                </View>
                <Text style={styles.modalSubtitle}>Choose a network to withdraw USDC from.</Text>

                {USDC_SUPPORTED_CHAINS.map(chainKey => (
                  <TouchableOpacity
                    key={chainKey}
                    style={styles.networkRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      setWithdrawChain(chainKey);
                      setWithdrawStep('form');
                    }}>
                    <Text style={styles.networkRowText}>{CHAIN_LABEL[chainKey]}</Text>
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

                <Text style={[styles.modalSectionLabel, styles.modalSectionLabelSpaced]}>Amount (USDC)</Text>
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
                <Text style={styles.resultText}>{withdrawAmount} USDC on {withdrawChain ? CHAIN_LABEL[withdrawChain] : ''}</Text>
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
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg},
    scrollContent: {paddingBottom: 32},
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.panel,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    bannerText: {flex: 1, color: colors.textPrimary, fontSize: 12.5, fontWeight: '600'},
    bannerDetail: {backgroundColor: colors.panel, paddingHorizontal: 16, paddingBottom: 12},
    bannerDetailText: {color: colors.textSecondary, fontSize: 11.5, lineHeight: 16},

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
    rewardsButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: colors.ctaBg,
    },
    rewardsButtonText: {color: colors.ctaText, fontSize: 14, fontWeight: '700'},

    name: {color: colors.textPrimary, fontSize: 22, fontWeight: '800', marginTop: 14, paddingHorizontal: 16},
    handle: {color: colors.textMuted, fontSize: 14, marginTop: 2, paddingHorizontal: 16},
    addBio: {color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 8, paddingHorizontal: 16},

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

    depositMethodRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      backgroundColor: colors.panel,
      borderRadius: 16,
      padding: 16,
      marginBottom: 10,
    },
    depositMethodDisabled: {opacity: 0.6},
    depositMethodText: {flex: 1, gap: 4},
    depositMethodTitleRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
    depositMethodTitle: {color: colors.textPrimary, fontSize: 15.5, fontWeight: '700'},
    depositMethodSubtitle: {color: colors.textMuted, fontSize: 12},
    comingSoonPill: {backgroundColor: colors.pillBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2},
    comingSoonText: {color: colors.textMuted, fontSize: 9.5, fontWeight: '700'},

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
    networkRowText: {color: colors.textPrimary, fontSize: 15, fontWeight: '700'},
    networkRowBalance: {color: colors.textMuted, fontSize: 13, fontWeight: '600'},

    withdrawRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, paddingVertical: 10},
    withdrawText: {color: colors.textMuted, fontSize: 12.5, fontWeight: '600'},

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
