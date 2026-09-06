// src/screens/PlaceholderScreen.tsx
//
// Shared shell for the not-yet-built tabs (Portfolio/Activity/Settings)
// — same reasoning as SearchScreen: a real, minimal screen rather than a
// mock, honestly labeled as pending.

import {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme, type Colors} from '../theme/ThemeContext';

export function PlaceholderScreen({title, note}: {title: string; note: string}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32},
    title: {fontSize: 20, fontWeight: '700', color: colors.textPrimary},
    note: {fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 280},
  });
}
