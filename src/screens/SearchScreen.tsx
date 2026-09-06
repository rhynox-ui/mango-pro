// src/screens/SearchScreen.tsx
//
// Real token-first search (build plan §4), not a mock: live-typed query,
// debounced against DexScreener's public search endpoint
// (src/core/tokenSearch.ts), ranked by real liquidity. GoPlus security
// badges and a full token detail page are still Phase 1 follow-ups —
// tapping a result goes straight to the trade screen for now.

import {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {SearchIcon} from '../components/icons';
import {CHAIN_LABEL} from '../core/chainData';
import {fmtCompactUsd, searchTokens, type TokenSearchResult} from '../core/tokenSearch';
import {useTheme, type Colors} from '../theme/ThemeContext';

// A query fires roughly every keystroke without this — DexScreener's
// search endpoint has no documented free-tier rate limit, but hammering
// it on every character is bad citizenship regardless, and doesn't
// change what the user sees mid-word.
const DEBOUNCE_MS = 350;

export function SearchScreen({onSelectToken}: {onSelectToken: (result: TokenSearchResult) => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TokenSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      searchTokens(trimmed).then(found => {
        // Stale-response guard: a slower earlier request landing after a
        // faster later one would otherwise flash outdated results.
        if (requestId !== requestIdRef.current) return;
        setResults(found);
        setLoading(false);
        setSearched(true);
      });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>What do you want to buy?</Text>
      <View style={styles.searchBox}>
        <SearchIcon color={colors.textMuted} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search any token, any chain"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
      </View>

      {loading && (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      )}

      {!loading && searched && results.length === 0 && (
        <View style={styles.centerState}>
          <Text style={styles.emptyText}>No tokens found for "{query.trim()}".</Text>
        </View>
      )}

      {!loading && !searched && (
        <View style={styles.centerState}>
          <Text style={styles.emptyText}>
            Search by name or ticker across every supported chain — results are ranked by real on-chain liquidity.
          </Text>
        </View>
      )}

      {!loading && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={item => `${item.chainKey}:${item.tokenAddress}`}
          contentContainerStyle={styles.resultsList}
          renderItem={({item}) => <ResultRow result={item} colors={colors} onPress={() => onSelectToken(item)} />}
        />
      )}
    </View>
  );
}

function ResultRow({result, colors, onPress}: {result: TokenSearchResult; colors: Colors; onPress: () => void}) {
  const styles = makeStyles(colors);
  const positive = (result.change24h ?? 0) >= 0;
  const marketCap = fmtCompactUsd(result.marketCapUsd);
  return (
    <TouchableOpacity style={styles.resultRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.resultAvatar}>
        <Text style={styles.resultAvatarText}>{result.symbol.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.resultInfo}>
        <Text style={styles.resultSymbol} numberOfLines={1}>
          {result.symbol}
        </Text>
        <Text style={styles.resultMeta} numberOfLines={1}>
          {CHAIN_LABEL[result.chainKey]}
          {marketCap ? ` · ${marketCap} MC` : ''}
        </Text>
      </View>
      <View style={styles.resultPriceCol}>
        <Text style={styles.resultPrice}>{result.priceUsd != null ? `$${result.priceUsd.toPrecision(3)}` : '—'}</Text>
        {result.change24h != null && (
          <Text style={[styles.resultChange, {color: positive ? colors.gain : colors.danger}]}>
            {positive ? '▲' : '▼'} {Math.abs(result.change24h).toFixed(2)}%
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, padding: 16, gap: 16},
    heading: {fontSize: 22, fontWeight: '700', color: colors.textPrimary},
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.panelBorder,
      backgroundColor: colors.input,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    searchInput: {flex: 1, fontSize: 15, color: colors.textPrimary},
    centerState: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 12},
    emptyText: {fontSize: 13, color: colors.textMuted, textAlign: 'center'},

    resultsList: {gap: 2},
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    resultAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.pillBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resultAvatarText: {color: colors.textPrimary, fontSize: 15, fontWeight: '700'},
    resultInfo: {flex: 1, minWidth: 0, gap: 2},
    resultSymbol: {color: colors.textPrimary, fontSize: 15.5, fontWeight: '700'},
    resultMeta: {color: colors.textMuted, fontSize: 12},
    resultPriceCol: {alignItems: 'flex-end', gap: 2},
    resultPrice: {color: colors.textPrimary, fontSize: 14, fontWeight: '700'},
    resultChange: {fontSize: 11.5, fontWeight: '700'},
  });
}
