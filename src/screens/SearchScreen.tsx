// src/screens/SearchScreen.tsx
//
// Real, honest shell for the token-first search (build plan §4:
// DexScreener-backed search, GoPlus badges, token detail page) — renders
// the actual intended layout rather than fake results, since the
// search/quote wiring doesn't exist yet.

import {useMemo} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {SearchIcon} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';

export function SearchScreen() {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>What do you want to buy?</Text>
      <View style={styles.searchBox}>
        <SearchIcon color={colors.textMuted} size={18} />
        <TextInput
          placeholder="Search any token, any chain"
          placeholderTextColor={colors.textMuted}
          editable={false}
          style={styles.searchInput}
        />
      </View>
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>
          Token search is coming in Phase 1 (build plan §4/§7) — this is the real screen shell, not a mock, waiting
          on the DexScreener search integration. Try the Swap tab for a live sample trade screen in the meantime.
        </Text>
      </View>
    </View>
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
    emptyState: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 12},
    emptyText: {fontSize: 13, color: colors.textMuted, textAlign: 'center'},
  });
}
