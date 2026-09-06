// src/screens/SecurityScreen.tsx
//
// The Security row's real destination — was a no-op placeholder before
// this (see SettingsScreen.tsx's own header on why an unbuilt
// destination there is an honest dead end, not a fabrication). The one
// real preference to expose here: auto-lock. App.tsx's AuthGate already
// runs the actual lock-on-background timer (a real gap it didn't have
// at all until this same change) — this screen only reads and writes
// that setting via AutoLockContext, it doesn't duplicate the timer.

import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ChevronLeftIcon} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {AUTO_LOCK_OPTIONS} from '../settings/autoLockPrefs';
import {useAutoLock} from '../settings/AutoLockContext';

export function SecurityScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {autoLockMs, setAutoLockMs} = useAutoLock();

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Security</Text>
      <Text style={styles.sectionLabel}>Auto-lock</Text>
      <Text style={styles.sectionHint}>Lock the wallet after this much time in the background.</Text>
      <ScrollView contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
        {AUTO_LOCK_OPTIONS.map((opt, i) => {
          const selected = opt.ms === autoLockMs;
          return (
            <TouchableOpacity key={opt.label} style={styles.row} activeOpacity={0.6} onPress={() => setAutoLockMs(opt.ms)}>
              <Text style={styles.rowLabel}>{opt.label}</Text>
              {selected && <Text style={styles.rowCheck}>✓</Text>}
              {i < AUTO_LOCK_OPTIONS.length - 1 && <View style={styles.divider} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16},
    backButton: {paddingTop: 8, paddingBottom: 4, alignSelf: 'flex-start'},
    title: {color: colors.textPrimary, fontSize: 34, fontWeight: '800', marginTop: 6, marginBottom: 8},
    sectionLabel: {color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10, marginBottom: 4},
    sectionHint: {color: colors.textMuted, fontSize: 12.5, marginBottom: 10},
    rows: {paddingBottom: 32},
    row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, position: 'relative'},
    rowLabel: {flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '500'},
    rowCheck: {color: colors.navActive, fontSize: 16, fontWeight: '800'},
    divider: {position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, backgroundColor: colors.divider},
  });
}
