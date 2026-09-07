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

import {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {FilterIcon, GearIcon, StarIcon} from '../components/icons';
import {fetchGraduatedTokens, fetchBondingTokens, fetchTrendingTokens, type DiscoveryToken} from '../core/discoveryFeed';
import {getWatchlist, isWatchlisted, subscribeWatchlist, toggleWatchlist} from '../wallet/watchlist';
import {useTheme, type Colors} from '../theme/ThemeContext';

const MANGO_MARK = require('../assets/mango-mark.png');

const TOKEN_FILTERS = ['Trending', 'Most held', 'Graduated', 'Bonding'] as const;
type TokenFilter = (typeof TOKEN_FILTERS)[number];
type DiscoveryTab = 'watchlist' | 'tokens';

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

export function HomeScreen({onOpenSettings, onSelectToken}: {onOpenSettings: () => void; onSelectToken?: (token: DiscoveryToken) => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = useState<DiscoveryTab>('tokens');
  const [filter, setFilter] = useState<TokenFilter>('Trending');
  const [tokens, setTokens] = useState<DiscoveryToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<DiscoveryToken[]>(getWatchlist());
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => subscribeWatchlist(setWatchlist), []);

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

  const listData = tab === 'watchlist' ? watchlist : tokens;
  const showingLiveList = tab === 'tokens' && filter !== 'Most held';

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.listContent}
      data={listData}
      keyExtractor={item => `${item.chainKey}:${item.tokenAddress}`}
      renderItem={({item}) => <TokenRow token={item} colors={colors} onPress={onSelectToken} />}
      ListHeaderComponent={
        <>
          <View style={styles.portfolioHeader}>
            <View style={styles.logoMark}>
              <Image source={MANGO_MARK} style={styles.logoMarkImage} resizeMode="contain" />
            </View>
            <Text style={styles.balance}>$0.00</Text>
            <TouchableOpacity style={styles.settingsButton} onPress={onOpenSettings} hitSlop={8}>
              <GearIcon color={colors.textSecondary} size={20} />
            </TouchableOpacity>
          </View>

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

          {tab === 'tokens' && (
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={styles.filterIconButton}
                activeOpacity={0.7}
                onPress={() => Alert.alert('Coming soon', "More filters (chain, market cap, liquidity) aren't built yet — use the presets below for now.")}>
                <FilterIcon color={colors.textSecondary} size={16} />
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

          {showingLiveList && loading && (
            <View style={styles.stateBlock}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          )}
          {showingLiveList && !loading && error && (
            <View style={styles.stateBlock}>
              <Text style={styles.stateText}>Couldn't load {filter.toLowerCase()} — {error}</Text>
              <TouchableOpacity onPress={() => setRefreshToken(t => t + 1)} activeOpacity={0.7}>
                <Text style={styles.stateRetry}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          {tab === 'tokens' && filter === 'Most held' && (
            <View style={styles.stateBlock}>
              <Text style={styles.stateText}>Most held isn't tracked yet — there's no real holder or usage data to rank by.</Text>
            </View>
          )}
          {tab === 'watchlist' && watchlist.length === 0 && (
            <View style={styles.stateBlock}>
              <Text style={styles.stateText}>Nothing on your watchlist yet — tap the star on any token to add it.</Text>
            </View>
          )}
        </>
      }
    />
  );
}

function TokenRow({token, colors, onPress}: {token: DiscoveryToken; colors: Colors; onPress?: (token: DiscoveryToken) => void}) {
  const styles = makeStyles(colors);
  const [imageFailed, setImageFailed] = useState(false);
  const [starred, setStarred] = useState(isWatchlisted(token));
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
      <TouchableOpacity
        style={styles.starButton}
        hitSlop={8}
        onPress={() => setStarred(toggleWatchlist(token))}
        activeOpacity={0.6}>
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

    discoveryTabs: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 22,
      paddingHorizontal: 16,
      paddingTop: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    discoveryTab: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 12, position: 'relative'},
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

    stateBlock: {paddingHorizontal: 16, paddingVertical: 24, alignItems: 'center', gap: 8},
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
  });
}
