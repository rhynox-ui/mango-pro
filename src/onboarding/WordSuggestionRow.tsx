// src/onboarding/WordSuggestionRow.tsx
//
// Ported verbatim from mango-mobile's own src/onboarding/WordSuggestionRow.tsx.

import {useMemo} from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity} from 'react-native';
import {useTheme, type Colors} from '../theme/ThemeContext';

export function WordSuggestionRow({suggestions, onPick}: {suggestions: string[]; onPick: (word: string) => void}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (suggestions.length === 0) return null;
  return (
    <ScrollView horizontal style={styles.scroll} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.row}>
      {suggestions.map(word => (
        <TouchableOpacity key={word} style={styles.chip} onPress={() => onPick(word)} activeOpacity={0.7}>
          <Text style={styles.chipText}>{word}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // flexGrow: 0 stops this horizontal ScrollView from claiming all
    // leftover vertical space in its flex:1 parent column.
    scroll: {flexGrow: 0},
    row: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8},
    chip: {alignSelf: 'flex-start', backgroundColor: colors.pillBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8},
    chipText: {color: colors.textPrimary, fontSize: 13, fontWeight: '600'},
  });
}
