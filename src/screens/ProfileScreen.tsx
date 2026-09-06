// src/screens/ProfileScreen.tsx
//
// Reached via the bottom nav's Profile tab. Unlike Home's discovery feed
// (deliberately mocked so the product demos with something in it), this
// screen shows a genuinely new account's real state: $0 balance, no
// trades, no followers — there's no auth/account system yet (build plan
// Phase 0), so fabricating a populated-looking profile here would be
// lying about what's actually built, not demonstrating the product.
// "Joined <month year>" is the one real data point: today's date.

import {useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Svg, {Line as SvgLine} from 'react-native-svg';
import {
  AlertCircleIcon,
  CalendarIcon,
  ChevronDownIcon,
  GearIcon,
  GiftIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  UploadIcon,
} from '../components/icons';
import {CHAIN_LABEL} from '../core/chainData';
import {useTheme, type Colors} from '../theme/ThemeContext';

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
  const styles = makeStyles(colors);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [positionTab, setPositionTab] = useState<PositionTab>('Open');
  const [assetFilter, setAssetFilter] = useState<AssetFilterKey>('All');
  const joined = useMemo(joinedLabel, []);

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
      <Text style={styles.handle}>@you</Text>
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
            <Text style={styles.totalCashValue}>$0</Text>
          </View>
        </View>
        <View style={styles.totalCashActions}>
          <TouchableOpacity style={styles.squareButton} hitSlop={4}>
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
  });
}
