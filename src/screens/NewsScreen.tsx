// src/screens/NewsScreen.tsx
//
// Its own dedicated page (pushed from Home's filter row, same pattern
// as HistoryScreen/SettingsScreen), not an inline tab sharing Home's
// token FlatList — a news article is structurally nothing like a
// DiscoveryToken (no price, no chain, no chart to open), so it gets its
// own screen and its own card layout rather than being squeezed into a
// token row.
//
// Real data from src/core/newsFeed.ts: three free, keyless RSS feeds,
// cached on-device (10-day retention, pruned automatically — an RSS
// feed that's never cleaned up grows forever for no benefit, since
// nothing here is useful to a user 10 days later) so a reopen shows the
// last real fetch immediately instead of a blank screen, then
// refreshes live in the background and again every 5 minutes while
// this screen stays open.

import {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, Image, Linking, RefreshControl, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ChevronLeftIcon} from '../components/icons';
import {FloatingMangoDecor} from '../components/FloatingMangoDecor';
import {fetchNewsFeed, loadCachedNewsArticles, type NewsArticle} from '../core/newsFeed';
import {useTheme, type Colors} from '../theme/ThemeContext';

const MANGO_MARK = require('../assets/mango-mark.png');

function formatNewsTime(timestamp: number | null): string {
  if (timestamp == null) return '';
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NewsCard({article, colors}: {article: NewsArticle; colors: Colors}) {
  const styles = makeStyles(colors);
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => Linking.openURL(article.link)}>
      {article.imageUrl && !imageFailed ? (
        <Image source={{uri: article.imageUrl}} style={styles.cardImage} onError={() => setImageFailed(true)} />
      ) : (
        <View style={styles.cardImageFallback}>
          <Image source={MANGO_MARK} style={styles.cardImageFallbackMark} resizeMode="contain" />
        </View>
      )}
      <Text style={styles.cardTitle} numberOfLines={3}>
        {article.title}
      </Text>
      <View style={styles.cardMetaRow}>
        <View style={styles.sourceBadge}>
          <Text style={styles.sourceBadgeText}>{article.source}</Text>
        </View>
        {article.publishedAt != null && <Text style={styles.cardTime}>{formatNewsTime(article.publishedAt)}</Text>}
      </View>
    </TouchableOpacity>
  );
}

export function NewsScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydratedFromCacheRef = useRef(false);

  const load = useCallback((opts: {showSpinner: boolean}) => {
    if (opts.showSpinner) setLoading(true);
    return fetchNewsFeed().then(result => {
      setArticles(result.articles);
      setError(result.error);
      setLoading(false);
      setRefreshing(false);
    });
  }, []);

  useEffect(() => {
    // Real cache on disk shows something immediately (see newsFeed.ts's
    // own header) — the live fetch right after either confirms it or
    // replaces it, never leaves a blank screen while waiting on
    // three network round-trips.
    loadCachedNewsArticles().then(cached => {
      if (cached.length > 0 && !hydratedFromCacheRef.current) {
        hydratedFromCacheRef.current = true;
        setArticles(cached);
        setLoading(false);
      }
    });
    load({showSpinner: !hydratedFromCacheRef.current});
    const interval = setInterval(() => load({showSpinner: false}), 5 * 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onRefresh() {
    setRefreshing(true);
    load({showSpinner: false});
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
          <ChevronLeftIcon color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.title}>News</Text>
      </View>

      {loading && articles.length === 0 && (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      )}

      {!loading && articles.length === 0 && error && (
        <View style={styles.stateBlock}>
          <FloatingMangoDecor />
          <Text style={styles.stateText}>Couldn't load news — {error}</Text>
          <TouchableOpacity onPress={() => load({showSpinner: true})} activeOpacity={0.7}>
            <Text style={styles.stateRetry}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && articles.length === 0 && !error && (
        <View style={styles.stateBlock}>
          <FloatingMangoDecor />
          <Text style={styles.stateText}>No news right now — check back shortly.</Text>
        </View>
      )}

      {articles.length > 0 && (
        <FlatList
          data={articles}
          keyExtractor={item => item.id}
          renderItem={({item}) => <NewsCard article={item} colors={colors} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />}
          ListFooterComponent={error ? <Text style={styles.footerError}>{error}</Text> : undefined}
        />
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16},
    header: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 4},
    backButton: {alignSelf: 'flex-start'},
    title: {color: colors.textPrimary, fontSize: 28, fontWeight: '800'},
    stateBlock: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, position: 'relative', overflow: 'hidden'},
    stateText: {color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24},
    stateRetry: {color: colors.textPrimary, fontSize: 13, fontWeight: '700'},
    listContent: {paddingTop: 8, paddingBottom: 32, gap: 14},
    footerError: {color: colors.textMuted, fontSize: 11.5, textAlign: 'center', paddingVertical: 16},

    card: {
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.panelBorder,
      borderRadius: 16,
      padding: 12,
      gap: 10,
    },
    cardImage: {width: '100%', height: 160, borderRadius: 12, backgroundColor: colors.pillBg},
    cardImageFallback: {width: '100%', height: 160, borderRadius: 12, backgroundColor: colors.pillBg, alignItems: 'center', justifyContent: 'center'},
    cardImageFallbackMark: {width: 40, height: 40, opacity: 0.4},
    cardTitle: {color: colors.textPrimary, fontSize: 16, fontWeight: '700', lineHeight: 21},
    cardMetaRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
    sourceBadge: {backgroundColor: colors.pillBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4},
    sourceBadgeText: {color: colors.textSecondary, fontSize: 11.5, fontWeight: '700'},
    cardTime: {color: colors.textMuted, fontSize: 11.5},
  });
}
