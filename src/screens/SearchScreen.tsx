// src/screens/SearchScreen.tsx
//
// Real, honest shell for the token-first search (build plan §4:
// DexScreener-backed search, GoPlus badges, token detail page) — renders
// the actual intended layout rather than fake results, since the
// search/quote wiring doesn't exist yet. The one live thing on this
// screen right now is the sample-trade-screen entry point below, so
// there's something real to look at while search itself is still Phase 1.

import React from 'react';
import {StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {useTheme, type Colors} from '../theme/ThemeContext';

function SearchGlyph({color}: {color: string}) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="11" cy="11" r="8" />
      <Path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export function SearchScreen({onOpenSample}: {onOpenSample: () => void}) {
  const {colors} = useTheme();
  const styles = useMemoStyles(colors);

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>What do you want to buy?</Text>
      <View style={styles.searchBox}>
        <SearchGlyph color={colors.textMuted} />
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
          on the DexScreener search integration.
        </Text>
        <TouchableOpacity style={styles.sampleButton} onPress={onOpenSample} activeOpacity={0.8}>
          <Text style={styles.sampleButtonText}>See a live sample trade screen</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function useMemoStyles(colors: Colors) {
  return React.useMemo(() => makeStyles(colors), [colors]);
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
    emptyState: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 48, paddingHorizontal: 12},
    emptyText: {fontSize: 13, color: colors.textMuted, textAlign: 'center'},
    sampleButton: {backgroundColor: colors.ctaBg, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12},
    sampleButtonText: {color: colors.ctaText, fontSize: 13.5, fontWeight: '700'},
  });
}
