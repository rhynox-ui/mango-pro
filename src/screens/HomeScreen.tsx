// src/screens/HomeScreen.tsx
//
// The app's primary landing screen — a token-discovery dashboard, not a
// traditional wallet homepage: portfolio balance up top, then straight
// into what's moving (trending tokens) before anything wallet-shaped.
// This is deliberately the first thing a new account lands on (see
// App.tsx's default tab); Profile/Settings are secondary, reached
// through the bottom nav and this screen's own gear icon.
//
// Colors follow this app's own monochrome rule rather than the
// reference mock's flat blue accents (tab indicator, "New" badge) — see
// palette.ts's header for why UI chrome here never gets a flat brand
// color. GAIN/DANGER for price movement is a direct, deliberate match to
// the reference: those are semantic trading colors in this design
// system already, not branding.
//
// No trader leaderboard and no "verified" checkmark — an explicit
// product decision to defer both until the app has real revenue/trade
// history: a leaderboard needs real PnL to compute, and a flat
// "verified" badge misrepresents permissionless tokens before there's a
// real safety signal (GoPlus) behind it.
//
// The token list is now real (src/core/discoveryFeed.ts) — Trending and
// Graduated/Bonding each hit a real API (see that file's own header for
// which, and pump.fun's frontend-api's unofficial-but-relied-upon
// status). "Most held" has no honest data source at all right now (no
// bulk on-chain holder-count API, and this app has no aggregate
// cross-user data of its own) — shown as a real "not tracked yet" empty
// state rather than silently relabeling Trending's numbers. Watchlist is
// real too now (src/wallet/watchlist.ts), not a dead second tab.

import {useMemo, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Image, Keyboard, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {FilterIcon, GearIcon, StarIcon} from '../components/icons';
import {FloatingMangoDecor} from '../components/FloatingMangoDecor';
import {fetchGraduatedTokens, fetchBondingTokens, fetchTrendingTokens, type DiscoveryToken} from '../core/discoveryFeed';
import {CHAIN_LABEL, type ChainKey} from '../core/chainData';
import {fetchUsdcPortfolio, type UsdcPortfolio} from '../core/usdcBalances';
import {getWatchlist, subscribeWatchlist, toggleWatchlist} from '../wallet/watchlist';
import {useSession} from '../wallet/SessionContext';
import {useTheme, type Colors} from '../theme/ThemeContext';

// Same small-local-copy convention every other screen already follows
// (see ProfileScreen.tsx's own formatWhen comment) rather than sharing
// one formatter across screens for a single function.
function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

const MANGO_MARK = require('../assets/mango-mark.png');

const TOKEN_FILTERS = ['Trending', 'Most held', 'Graduated', 'Bonding'] as const;
type TokenFilter = (typeof TOKEN_FILTERS)[number];
type DiscoveryTab = 'watchlist' | 'tokens';

// Real client-side sort over whichever list is already on screen — every
// field here (marketCapUsd, change24h) is real data discoveryFeed.ts
// already fetched, not a new source. 'default' keeps each filter's own
// real ranking (DexScreener's boost order for Trending, pump.fun's own
// market-cap-sorted order for Graduated/Bonding) rather than silently
// re-ordering it, which is why it's the first option, not a bare "None".
const SORT_OPTIONS = [
  {key: 'default', label: 'Default'},
  {key: 'mcapDesc', label: 'Market cap: high to low'},
  {key: 'mcapAsc', label: 'Market cap: low to high'},
  {key: 'changeDesc', label: '24h change: gainers first'},
  {key: 'changeAsc', label: '24h change: losers first'},
  {key: 'volumeDesc', label: 'Most volume (24h)'},
  {key: 'txDesc', label: 'Most transactions (24h)'},
  {key: 'liqDesc', label: 'Most liquidity'},
  {key: 'ageNewest', label: 'Pair age: newest first'},
  {key: 'ageOldest', label: 'Pair age: oldest first'},
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]['key'];

function sortTokens(tokens: DiscoveryToken[], sort: SortKey): DiscoveryToken[] {
  if (sort === 'default') return tokens;
  const withRank = (value: number | null, missingLast: boolean) => (value == null ? (missingLast ? -Infinity : Infinity) : value);
  const sorted = [...tokens];
  switch (sort) {
    case 'mcapDesc':
      sorted.sort((a, b) => withRank(b.marketCapUsd, true) - withRank(a.marketCapUsd, true));
      break;
    case 'mcapAsc':
      sorted.sort((a, b) => withRank(a.marketCapUsd, false) - withRank(b.marketCapUsd, false));
      break;
    case 'changeDesc':
      sorted.sort((a, b) => withRank(b.change24h, true) - withRank(a.change24h, true));
      break;
    case 'changeAsc':
      sorted.sort((a, b) => withRank(a.change24h, false) - withRank(b.change24h, false));
      break;
    case 'volumeDesc':
      sorted.sort((a, b) => withRank(b.volumeUsd24h, true) - withRank(a.volumeUsd24h, true));
      break;
    case 'txDesc':
      sorted.sort((a, b) => withRank(b.txCount24h, true) - withRank(a.txCount24h, true));
      break;
    case 'liqDesc':
      sorted.sort((a, b) => withRank(b.liquidityUsd, true) - withRank(a.liquidityUsd, true));
      break;
    case 'ageNewest':
      sorted.sort((a, b) => withRank(b.createdAt, true) - withRank(a.createdAt, true));
      break;
    case 'ageOldest':
      sorted.sort((a, b) => withRank(a.createdAt, false) - withRank(b.createdAt, false));
      break;
  }
  return sorted;
}

// Real client-side filter over marketCapUsd — same already-fetched field
// sortTokens's own mcap options use, not a new source. A token with no
// real marketCapUsd (pump.fun's own listing sometimes omits it) is
// excluded rather than guessed into a bucket, same "never fabricate"
// rule as everywhere else this app touches real-but-incomplete data.
const MCAP_PRESETS: {label: string; min: number | null; max: number | null}[] = [
  {label: 'Under $100K', min: null, max: 100_000},
  {label: '$100K–$1M', min: 100_000, max: 1_000_000},
  {label: '$1M–$10M', min: 1_000_000, max: 10_000_000},
  {label: '$10M–$100M', min: 10_000_000, max: 100_000_000},
  {label: '$100M–$1B', min: 100_000_000, max: 1_000_000_000},
  {label: 'Over $1B', min: 1_000_000_000, max: null},
];

type McapRange = {min: number | null; max: number | null};

/** Accepts plain numbers or a k/m/b suffix (e.g. "1.5m" -> 1_500_000) — the same compact shape formatMarketCap already displays, so typing back what you see just works. Empty/unparsable input is null, never a fabricated 0. */
function parseCompactUsd(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const match = trimmed.match(/^\$?([\d.]+)\s*([kmb])?$/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const multiplier = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : match[2] === 'b' ? 1_000_000_000 : 1;
  return base * multiplier;
}

function filterByMcap(tokens: DiscoveryToken[], range: McapRange | null): DiscoveryToken[] {
  if (!range) return tokens;
  return tokens.filter(t => {
    if (t.marketCapUsd == null) return false;
    if (range.min != null && t.marketCapUsd < range.min) return false;
    if (range.max != null && t.marketCapUsd > range.max) return false;
    return true;
  });
}

function formatPrice(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1) return `$${n.toFixed(2)}`;
  // Sub-cent meme-token prices need more than 2 decimals to mean
  // anything ($0.00 for everything under a cent would be useless) —
  // same real-precision reasoning fmtCompactUsd's own callers apply.
  return `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function formatMarketCap(n: number | null): string {
  if (n == null) return 'MC —';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B MC`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M MC`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K MC`;
  return `$${n.toFixed(0)} MC`;
}

export function HomeScreen({
  onOpenSettings,
  onSelectToken,
  onOpenDeposit,
}: {
  onOpenSettings: () => void;
  onSelectToken?: (token: DiscoveryToken) => void;
  onOpenDeposit?: () => void;
}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {session} = useSession();
  const [usdcPortfolio, setUsdcPortfolio] = useState<UsdcPortfolio | null>(null);
  const [tab, setTab] = useState<DiscoveryTab>('tokens');
  const [filter, setFilter] = useState<TokenFilter>('Trending');
  const [tokens, setTokens] = useState<DiscoveryToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<DiscoveryToken[]>(getWatchlist());
  const [refreshToken, setRefreshToken] = useState(0);
  const [sort, setSort] = useState<SortKey>('default');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  // 'all' by default — a real per-launchpad platform filter (Four.meme,
  // Flap, Long.xyz, StonkFun...) isn't honestly buildable yet: none of
  // those platforms has a free public API, and Graduated/Bonding is
  // pump.fun-only today, so there's no real "platform" field to filter
  // by (see discoveryFeed.ts's own header). chainKey IS real on every
  // token already fetched, so a chain filter ships now without
  // fabricating anything; it's the honest slice of "fewer, more relevant
  // tokens" available today, with true platform filtering tracked
  // separately for once more real launchpad sources exist.
  const [chainFilter, setChainFilter] = useState<ChainKey | 'all'>('all');
  // Applied range — null means no filter. Kept separate from the draft
  // min/max text fields below so a half-typed number never silently
  // filters the list before the user actually applies it.
  const [mcapFilter, setMcapFilter] = useState<McapRange | null>(null);
  const [mcapMinDraft, setMcapMinDraft] = useState('');
  const [mcapMaxDraft, setMcapMaxDraft] = useState('');
  const [mcapError, setMcapError] = useState('');

  useEffect(() => subscribeWatchlist(setWatchlist), []);

  // Real bug this fixes (found in a security/bug audit pass): this
  // header balance was a literal hardcoded "$0.00" string, never wired
  // to anything, while ProfileScreen's own Total cash correctly showed
  // the real number from this exact same fetchUsdcPortfolio(session) —
  // meaning a user with a real deposited balance saw it as $0 on the
  // app's own landing tab. No snapshot-recording here (unlike
  // ProfileScreen's own effect) — that already happens once, on
  // Profile's mount/refresh; duplicating it here would just double-write
  // the same history.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchUsdcPortfolio(session).then(portfolio => {
      if (!cancelled) setUsdcPortfolio(portfolio);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Switching discovery filter can move to a chain the previous
  // selection doesn't cover (e.g. Graduated/Bonding is Solana-only) —
  // reset rather than silently show an empty list. Market cap is a
  // real range regardless of source, but a filter this narrow silently
  // carried across an unrelated tab switch is still surprising — reset
  // it the same way for the same "never silently hide everything"
  // reason.
  useEffect(() => {
    setChainFilter('all');
    setMcapFilter(null);
    setMcapMinDraft('');
    setMcapMaxDraft('');
    setMcapError('');
  }, [filter]);

  useEffect(() => {
    if (filter === 'Most held') {
      // No honest data source exists for this yet — see this file's own
      // header. Deliberately not fetched at all.
      setTokens([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const fetcher = filter === 'Trending' ? fetchTrendingTokens : filter === 'Graduated' ? fetchGraduatedTokens : fetchBondingTokens;
    fetcher().then(result => {
      if (cancelled) return;
      setTokens(result.tokens);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filter, refreshToken]);

  const unsortedListData = tab === 'watchlist' ? watchlist : tokens;

  // Real counts per chain actually present in this list right now — never
  // a static "every chain this app supports" list, so a chip only ever
  // offers a chain that genuinely has tokens to show.
  const chainCounts = useMemo(() => {
    const counts = new Map<ChainKey, number>();
    for (const t of unsortedListData) counts.set(t.chainKey, (counts.get(t.chainKey) ?? 0) + 1);
    return counts;
  }, [unsortedListData]);
  const chainChipOptions = useMemo(
    () => Array.from(chainCounts.entries()).sort((a, b) => b[1] - a[1]),
    [chainCounts],
  );

  const chainFilteredData = useMemo(
    () => (chainFilter === 'all' ? unsortedListData : unsortedListData.filter(t => t.chainKey === chainFilter)),
    [unsortedListData, chainFilter],
  );
  const mcapFilteredData = useMemo(() => filterByMcap(chainFilteredData, mcapFilter), [chainFilteredData, mcapFilter]);
  const listData = useMemo(() => sortTokens(mcapFilteredData, sort), [mcapFilteredData, sort]);
  const showingLiveList = tab === 'tokens' && filter !== 'Most held';
  // Real bug this closes: TokenRow used to freeze its own "starred" look
  // in local state the moment it mounted (`useState(isWatchlisted(token))`),
  // so a token starred in an earlier session — or one whose watchlist
  // status only resolved AFTER this row had already rendered — could
  // show the wrong star forever, and FlatList had no reason to re-render
  // Tokens-tab rows at all when `watchlist` changed (only `tokens` is its
  // `data`). Deriving the starred set here and passing `extraData` below
  // makes every row's star a live reflection of the real store, not a
  // one-time snapshot.
  const watchlistKeys = useMemo(() => new Set(watchlist.map(t => `${t.chainKey}:${t.tokenAddress.toLowerCase()}`)), [watchlist]);

  return (
    <>
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.listContent}
      data={listData}
      extraData={watchlistKeys}
      keyExtractor={item => `${item.chainKey}:${item.tokenAddress}`}
      renderItem={({item}) => (
        <TokenRow token={item} colors={colors} onPress={onSelectToken} starred={watchlistKeys.has(`${item.chainKey}:${item.tokenAddress.toLowerCase()}`)} />
      )}
      ListHeaderComponent={
        <>
          <View style={styles.portfolioHeader}>
            <View style={styles.logoMark}>
              <Image source={MANGO_MARK} style={styles.logoMarkImage} resizeMode="contain" />
            </View>
            <Text style={styles.balance}>${usdcPortfolio ? formatUsd(usdcPortfolio.totalUsd) : '0.00'}</Text>
            <TouchableOpacity style={styles.settingsButton} onPress={onOpenSettings} hitSlop={8}>
              <GearIcon color={colors.textSecondary} size={20} />
            </TouchableOpacity>
          </View>

          <View style={styles.discoveryTabsRow}>
            <View style={styles.discoveryTabs}>
              <TouchableOpacity style={styles.discoveryTab} onPress={() => setTab('watchlist')} activeOpacity={0.7}>
                <StarIcon color={tab === 'watchlist' ? colors.textPrimary : colors.textMuted} size={15} />
                <Text style={[styles.discoveryTabText, tab === 'watchlist' && styles.discoveryTabTextActive]}>Watchlist</Text>
                {tab === 'watchlist' && <View style={styles.discoveryTabIndicator} />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.discoveryTab} onPress={() => setTab('tokens')} activeOpacity={0.7}>
                <Text style={[styles.discoveryTabText, tab === 'tokens' && styles.discoveryTabTextActive]}>Tokens</Text>
                {tab === 'tokens' && <View style={styles.discoveryTabIndicator} />}
              </TouchableOpacity>
            </View>
            {onOpenDeposit && (
              <TouchableOpacity style={styles.depositButton} onPress={onOpenDeposit} activeOpacity={0.7}>
                <Text style={styles.depositButtonText}>Deposit</Text>
              </TouchableOpacity>
            )}
          </View>

          {tab === 'tokens' && (
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterIconButton, (sort !== 'default' || mcapFilter) && styles.filterIconButtonActive]}
                activeOpacity={0.7}
                onPress={() => setSortMenuOpen(true)}>
                <FilterIcon color={sort !== 'default' || mcapFilter ? colors.ctaText : colors.textSecondary} size={16} />
              </TouchableOpacity>
              {TOKEN_FILTERS.map(f => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterPill, filter === f && styles.filterPillActive]}
                  onPress={() => setFilter(f)}
                  activeOpacity={0.7}>
                  <Text style={[styles.filterPillText, filter === f && styles.filterPillTextActive]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Real per-launchpad platform filter isn't honestly buildable
              yet (see chainFilter's own comment above) — a chain filter
              is the real, immediately-available slice, and only shown
              once this list actually spans more than one chain. */}
          {tab === 'tokens' && chainChipOptions.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chainChipRow} contentContainerStyle={styles.chainChipRowContent}>
              <TouchableOpacity
                style={[styles.chainChip, chainFilter === 'all' && styles.chainChipActive]}
                onPress={() => setChainFilter('all')}
                activeOpacity={0.7}>
                <Text style={[styles.chainChipText, chainFilter === 'all' && styles.chainChipTextActive]}>All chains</Text>
              </TouchableOpacity>
              {chainChipOptions.map(([chainKey, count]) => (
                <TouchableOpacity
                  key={chainKey}
                  style={[styles.chainChip, chainFilter === chainKey && styles.chainChipActive]}
                  onPress={() => setChainFilter(chainKey)}
                  activeOpacity={0.7}>
                  <Text style={[styles.chainChipText, chainFilter === chainKey && styles.chainChipTextActive]}>
                    {CHAIN_LABEL[chainKey] ?? chainKey} ({count})
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {showingLiveList && loading && (
            <View style={styles.stateBlock}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          )}
          {showingLiveList && !loading && error && (
            <View style={styles.stateBlock}>
              <FloatingMangoDecor />
              <Text style={styles.stateText}>Couldn't load {filter.toLowerCase()} — {error}</Text>
              <TouchableOpacity onPress={() => setRefreshToken(t => t + 1)} activeOpacity={0.7}>
                <Text style={styles.stateRetry}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          {showingLiveList && !loading && !error && (chainFilter !== 'all' || mcapFilter) && listData.length === 0 && (
            <View style={styles.stateBlock}>
              <FloatingMangoDecor />
              <Text style={styles.stateText}>
                No {filter.toLowerCase()} tokens
                {chainFilter !== 'all' ? ` on ${CHAIN_LABEL[chainFilter] ?? chainFilter}` : ''}
                {mcapFilter ? ' in this market cap range' : ''} right now.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setChainFilter('all');
                  setMcapFilter(null);
                  setMcapMinDraft('');
                  setMcapMaxDraft('');
                }}
                activeOpacity={0.7}>
                <Text style={styles.stateRetry}>Clear filters</Text>
              </TouchableOpacity>
            </View>
          )}
          {tab === 'tokens' && filter === 'Most held' && (
            <View style={styles.stateBlock}>
              <FloatingMangoDecor />
              <Text style={styles.stateText}>Most held isn't tracked yet — there's no real holder or usage data to rank by.</Text>
            </View>
          )}
          {tab === 'watchlist' && watchlist.length === 0 && (
            <View style={styles.stateBlock}>
              <FloatingMangoDecor />
              <Text style={styles.stateText}>Nothing on your watchlist yet — tap the star on any token to add it.</Text>
            </View>
          )}
        </>
      }
    />

    <Modal visible={sortMenuOpen} transparent animationType="fade" onRequestClose={() => setSortMenuOpen(false)}>
      <TouchableOpacity style={styles.sortBackdrop} activeOpacity={1} onPress={() => setSortMenuOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.sortCard} onPress={() => {}}>
          <Text style={styles.sortTitle}>Sort by</Text>
          {/* Now 10 options (was 5) — capped + scrollable so a longer
              list never gets clipped top/bottom on a shorter phone or
              with larger accessibility text sizes. */}
          <ScrollView style={styles.sortScroll} bounces={false}>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={styles.sortRow}
                activeOpacity={0.7}
                onPress={() => {
                  setSort(opt.key);
                  setSortMenuOpen(false);
                }}>
                <Text style={styles.sortRowText}>{opt.label}</Text>
                {sort === opt.key && <Text style={styles.sortCheck}>✓</Text>}
              </TouchableOpacity>
            ))}

            <View style={styles.mcapDivider} />
            <Text style={styles.sortTitle}>Market cap</Text>
            <View style={styles.mcapPresetWrap}>
              {MCAP_PRESETS.map(preset => {
                const selected = mcapFilter?.min === preset.min && mcapFilter?.max === preset.max;
                return (
                  <TouchableOpacity
                    key={preset.label}
                    style={[styles.mcapChip, selected && styles.mcapChipActive]}
                    activeOpacity={0.7}
                    onPress={() => {
                      setMcapFilter(preset);
                      setMcapMinDraft(preset.min != null ? String(preset.min) : '');
                      setMcapMaxDraft(preset.max != null ? String(preset.max) : '');
                      setMcapError('');
                    }}>
                    <Text style={[styles.mcapChipText, selected && styles.mcapChipTextActive]}>{preset.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.mcapCustomRow}>
              <TextInput
                value={mcapMinDraft}
                onChangeText={t => {
                  setMcapMinDraft(t);
                  setMcapError('');
                }}
                placeholder="Min"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.mcapInput}
              />
              <Text style={styles.mcapCustomDash}>–</Text>
              <TextInput
                value={mcapMaxDraft}
                onChangeText={t => {
                  setMcapMaxDraft(t);
                  setMcapError('');
                }}
                placeholder="Max"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.mcapInput}
              />
            </View>
            {!!mcapError && <Text style={styles.mcapError}>{mcapError}</Text>}
            <View style={styles.mcapActionRow}>
              <TouchableOpacity
                style={styles.mcapClearButton}
                activeOpacity={0.7}
                onPress={() => {
                  setMcapFilter(null);
                  setMcapMinDraft('');
                  setMcapMaxDraft('');
                  setMcapError('');
                }}>
                <Text style={styles.mcapClearButtonText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mcapApplyButton}
                activeOpacity={0.7}
                onPress={() => {
                  const min = parseCompactUsd(mcapMinDraft);
                  const max = parseCompactUsd(mcapMaxDraft);
                  if (!mcapMinDraft.trim() && !mcapMaxDraft.trim()) {
                    setMcapFilter(null);
                    setMcapError('');
                    Keyboard.dismiss();
                    return;
                  }
                  if ((mcapMinDraft.trim() && min == null) || (mcapMaxDraft.trim() && max == null)) {
                    setMcapError("Couldn't read that number — try e.g. 500K or 2.5M.");
                    return;
                  }
                  if (min != null && max != null && min > max) {
                    setMcapError('Min is higher than Max.');
                    return;
                  }
                  setMcapFilter({min, max});
                  setMcapError('');
                  Keyboard.dismiss();
                }}>
                <Text style={styles.mcapApplyButtonText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
    </>
  );
}

function TokenRow({
  token,
  colors,
  onPress,
  starred,
}: {
  token: DiscoveryToken;
  colors: Colors;
  onPress?: (token: DiscoveryToken) => void;
  starred: boolean;
}) {
  const styles = makeStyles(colors);
  const [imageFailed, setImageFailed] = useState(false);
  const positive = (token.change24h ?? 0) >= 0;

  return (
    <TouchableOpacity style={styles.tokenRow} activeOpacity={onPress ? 0.6 : 1} onPress={() => onPress?.(token)} disabled={!onPress}>
      {token.imageUrl && !imageFailed ? (
        <Image source={{uri: token.imageUrl}} style={styles.tokenAvatarImage} onError={() => setImageFailed(true)} />
      ) : (
        <View style={styles.tokenAvatar}>
          <Text style={styles.tokenAvatarText}>{token.symbol.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.tokenInfo}>
        <Text style={styles.tokenSymbol} numberOfLines={1}>
          {token.symbol}
        </Text>
        <Text style={styles.tokenMarketCap}>{formatMarketCap(token.marketCapUsd)}</Text>
      </View>
      <View style={styles.tokenPriceCol}>
        <Text style={styles.tokenPrice}>{formatPrice(token.priceUsd)}</Text>
        {token.change24h != null && (
          <Text style={[styles.tokenChange, {color: positive ? colors.gain : colors.danger}]}>
            {positive ? '▲' : '▼'} {Math.abs(token.change24h).toFixed(2)}%
          </Text>
        )}
      </View>
      <TouchableOpacity style={styles.starButton} hitSlop={8} onPress={() => toggleWatchlist(token)} activeOpacity={0.6}>
        <StarIcon color={starred ? colors.textPrimary : colors.textMuted} size={16} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1},
    listContent: {paddingBottom: 24},
    portfolioHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 12,
    },
    logoMark: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: colors.panel,
    },
    logoMarkImage: {width: 28, height: 28},
    balance: {color: colors.textPrimary, fontSize: 26, fontWeight: '700'},
    settingsButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.panel,
    },

    discoveryTabsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    discoveryTabs: {flexDirection: 'row', alignItems: 'center', gap: 22},
    discoveryTab: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 12, position: 'relative'},
    depositButton: {backgroundColor: colors.ctaBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 10},
    depositButtonText: {color: colors.ctaText, fontSize: 12.5, fontWeight: '700'},
    discoveryTabText: {color: colors.textMuted, fontSize: 15, fontWeight: '600'},
    discoveryTabTextActive: {color: colors.textPrimary, fontWeight: '700'},
    discoveryTabIndicator: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.ctaBg,
    },
    filterRow: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12},
    filterIconButton: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
    },
    filterIconButtonActive: {backgroundColor: colors.ctaBg, borderColor: colors.ctaBg},
    filterPill: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 999,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
    },
    filterPillActive: {backgroundColor: colors.ctaBg, borderColor: colors.ctaBg},
    filterPillText: {color: colors.textSecondary, fontSize: 13, fontWeight: '600'},
    filterPillTextActive: {color: colors.ctaText},

    chainChipRow: {marginTop: -4, marginBottom: 4},
    chainChipRowContent: {paddingHorizontal: 16, gap: 6},
    chainChip: {
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
    },
    chainChipActive: {backgroundColor: colors.ctaBg, borderColor: colors.ctaBg},
    chainChipText: {color: colors.textMuted, fontSize: 12, fontWeight: '600'},
    chainChipTextActive: {color: colors.ctaText},

    stateBlock: {paddingHorizontal: 16, paddingVertical: 24, alignItems: 'center', gap: 8, position: 'relative', overflow: 'hidden'},
    stateText: {color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18},
    stateRetry: {color: colors.textPrimary, fontSize: 13, fontWeight: '700'},

    tokenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    tokenAvatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.pillBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tokenAvatarImage: {width: 52, height: 52, borderRadius: 26, backgroundColor: colors.pillBg},
    tokenAvatarText: {color: colors.textPrimary, fontSize: 17, fontWeight: '700'},
    tokenInfo: {flex: 1, minWidth: 0, gap: 3},
    tokenSymbol: {color: colors.textPrimary, fontSize: 17, fontWeight: '700'},
    tokenMarketCap: {color: colors.textMuted, fontSize: 12.5},
    tokenPriceCol: {alignItems: 'flex-end', gap: 3},
    tokenPrice: {color: colors.textPrimary, fontSize: 15.5, fontWeight: '700'},
    tokenChange: {fontSize: 12.5, fontWeight: '700'},
    starButton: {paddingLeft: 4},

    sortBackdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24},
    sortCard: {
      backgroundColor: colors.panel,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderRadius: 16,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    sortTitle: {color: colors.textMuted, fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4},
    sortScroll: {maxHeight: 420},
    sortRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    sortRowText: {color: colors.textPrimary, fontSize: 14.5, fontWeight: '600'},
    sortCheck: {color: colors.navActive, fontSize: 15, fontWeight: '800'},

    mcapDivider: {height: 1, backgroundColor: colors.divider, marginTop: 6, marginBottom: 4},
    mcapPresetWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: 4},
    mcapChip: {
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
    },
    mcapChipActive: {backgroundColor: colors.ctaBg, borderColor: colors.ctaBg},
    mcapChipText: {color: colors.textSecondary, fontSize: 12, fontWeight: '600'},
    mcapChipTextActive: {color: colors.ctaText},
    mcapCustomRow: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, marginTop: 8},
    mcapInput: {
      flex: 1,
      backgroundColor: colors.input,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 9,
      color: colors.textPrimary,
      fontSize: 13.5,
    },
    mcapCustomDash: {color: colors.textMuted, fontSize: 13},
    mcapError: {color: colors.danger, fontSize: 11.5, paddingHorizontal: 14, marginTop: 6},
    mcapActionRow: {flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginTop: 12, marginBottom: 4},
    mcapClearButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.pillBg,
    },
    mcapClearButtonText: {color: colors.textPrimary, fontSize: 13, fontWeight: '700'},
    mcapApplyButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.ctaBg,
    },
    mcapApplyButtonText: {color: colors.ctaText, fontSize: 13, fontWeight: '700'},
  });
}
