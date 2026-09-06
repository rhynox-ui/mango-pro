// src/screens/AppearanceScreen.tsx
//
// The "Appearance and Haptics" row's real destination — same "real
// shell, not a mock" reasoning as SecurityScreen.tsx's own header. Only
// Appearance is wired here: ThemeContext.tsx already had a complete,
// persisted light/dark toggle (setMode/toggleMode) with nothing in the
// UI ever calling it — a real gap confirmed by grep — so a user had no
// way to leave whichever mode they landed on. Haptics has no
// implementation anywhere in this app yet, so it isn't offered as a
// fake toggle here; add it once a real haptics module exists, the same
// way mango-mobile's own SettingsScreen pairs the two.

import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ChevronLeftIcon} from '../components/icons';
import {useTheme, type Colors, type ThemeMode} from '../theme/ThemeContext';

const THEME_OPTIONS: {label: string; mode: ThemeMode}[] = [
  {label: 'Light', mode: 'light'},
  {label: 'Dark', mode: 'dark'},
];

export function AppearanceScreen({onBack}: {onBack: () => void}) {
  const {colors, mode, setMode} = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Appearance</Text>
      <Text style={styles.sectionLabel}>Theme</Text>
      <View style={styles.rows}>
        {THEME_OPTIONS.map((opt, i) => {
          const selected = opt.mode === mode;
          return (
            <TouchableOpacity key={opt.mode} style={styles.row} activeOpacity={0.6} onPress={() => setMode(opt.mode)}>
              <Text style={styles.rowLabel}>{opt.label}</Text>
              {selected && <Text style={styles.rowCheck}>✓</Text>}
              {i < THEME_OPTIONS.length - 1 && <View style={styles.divider} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16},
    backButton: {paddingTop: 8, paddingBottom: 4, alignSelf: 'flex-start'},
    title: {color: colors.textPrimary, fontSize: 34, fontWeight: '800', marginTop: 6, marginBottom: 8},
    sectionLabel: {color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10, marginBottom: 4},
    rows: {paddingBottom: 32},
    row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, position: 'relative'},
    rowLabel: {flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '500'},
    rowCheck: {color: colors.navActive, fontSize: 16, fontWeight: '800'},
    divider: {position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, backgroundColor: colors.divider},
  });
}
