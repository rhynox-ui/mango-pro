// src/screens/HomeScreen.tsx
//
// The app's primary landing screen — a token-discovery dashboard, not a
// traditional wallet homepage: portfolio balance up top, then straight
// into what's moving (trending tokens) before anything wallet-shaped.
// This is deliberately the first thing a new account lands on (see
// App.tsx's default tab); Profile/Settings are secondary, reached
// through the bottom nav and Profile's own gear icon.
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
// The token list is mock data (src/data/mockDiscovery) — the one
// deliberate exception to this app's "no fake numbers" discipline,
// because an empty discovery feed wouldn't demonstrate the product at
// all. The portfolio balance is NOT mocked: a new account genuinely has $0.

import {useState} from 'react';
import {Alert, FlatList, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {FilterIcon, StarIcon} from '../components/icons';
import {MOCK_TOKENS, TOKEN_FILTERS, type DiscoveryToken, type TokenFilter} from '../data/mockDiscovery';
import {useTheme, type Colors} from '../theme/ThemeContext';

const MANGO_MARK = require('../assets/mango-mark.png');

type DiscoveryTab = 'watchlist' | 'tokens';

export function HomeScreen() {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const [tab, setTab] = useState<DiscoveryTab>('tokens');
  const [filter, setFilter] = useState<TokenFilter>('Trending');

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.listContent}
      data={MOCK_TOKENS}
      keyExtractor={item => item.id}
      renderItem={({item}) => <TokenRow token={item} colors={colors} />}
      ListHeaderComponent={
        <>
          <View style={styles.portfolioHeader}>
            <View style={styles.logoMark}>
              <Image source={MANGO_MARK} style={styles.logoMarkImage} resizeMode="contain" />
            </View>
            <Text style={styles.balance}>$0.00</Text>
            <View style={styles.logoMarkSpacer} />
          </View>

          <View style={styles.discoveryTabs}>
            <TouchableOpacity style={styles.discoveryTab} onPress={() => setTab('watchlist')} activeOpacity={0.7}>
              <StarIcon color={tab === 'watchlist' ? colors.textPrimary : colors.textMuted} size={15} />
              <Text style={[styles.discoveryTabText, tab === 'watchlist' && styles.discoveryTabTextActive]}>Watchlist</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.discoveryTab} onPress={() => setTab('tokens')} activeOpacity={0.7}>
              <Text style={[styles.discoveryTabText, tab === 'tokens' && styles.discoveryTabTextActive]}>Tokens</Text>
              {tab === 'tokens' && <View style={styles.discoveryTabIndicator} />}
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
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
          </ScrollView>
        </>
      }
    />
  );
}

function TokenRow({token, colors}: {token: DiscoveryToken; colors: Colors}) {
  const styles = makeStyles(colors);
  const positive = token.change24h >= 0;
  return (
    <View style={styles.tokenRow}>
      <View style={styles.tokenAvatar}>
        <Text style={styles.tokenAvatarText}>{token.avatarInitial}</Text>
      </View>
      <View style={styles.tokenInfo}>
        <Text style={styles.tokenSymbol} numberOfLines={1}>
          {token.symbol}
        </Text>
        <Text style={styles.tokenMarketCap}>{token.marketCapLabel}</Text>
      </View>
      <View style={styles.tokenPriceCol}>
        <Text style={styles.tokenPrice}>{token.price}</Text>
        <Text style={[styles.tokenChange, {color: positive ? colors.gain : colors.danger}]}>
          {positive ? '▲' : '▼'} {Math.abs(token.change24h).toFixed(2)}%
        </Text>
      </View>
    </View>
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
    logoMarkSpacer: {width: 56},
    balance: {color: colors.textPrimary, fontSize: 26, fontWeight: '700'},

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
    tokenAvatarText: {color: colors.textPrimary, fontSize: 17, fontWeight: '700'},
    tokenInfo: {flex: 1, minWidth: 0, gap: 3},
    tokenSymbol: {color: colors.textPrimary, fontSize: 17, fontWeight: '700'},
    tokenMarketCap: {color: colors.textMuted, fontSize: 12.5},
    tokenPriceCol: {alignItems: 'flex-end', gap: 3},
    tokenPrice: {color: colors.textPrimary, fontSize: 15.5, fontWeight: '700'},
    tokenChange: {fontSize: 12.5, fontWeight: '700'},
  });
}
