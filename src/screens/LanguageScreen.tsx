// src/screens/LanguageScreen.tsx
//
// The Language row's real destination, replacing the honest no-op
// placeholder SettingsScreen.tsx used to show (see that file's own old
// comment on why a picker without real translations behind it would
// have been fake choice). Real i18next language switching now lives in
// src/i18n/index.ts; this screen is just the picker over it — same
// row/radio-check pattern SecurityScreen.tsx's own Auto-lock section
// already uses.
//
// "System" re-detects the device's real OS locale (src/i18n's
// detectSystemLanguage, backed by react-native's own built-in
// I18nManager) rather than pinning to whatever language happened to be
// active when picked — choosing it again after changing the OS
// language should track that change on the next launch.

import {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {ChevronLeftIcon} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {SUPPORTED_LANGUAGES, getLanguagePreference, setLanguagePreference, type LanguageCode} from '../i18n';

export function LanguageScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const {t} = useTranslation();
  const styles = makeStyles(colors);
  const [preference, setPreference] = useState<'system' | LanguageCode | null>(null);

  useEffect(() => {
    getLanguagePreference().then(setPreference);
  }, []);

  async function choose(choice: 'system' | LanguageCode) {
    setPreference(choice);
    await setLanguagePreference(choice);
  }

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>{t('language.title')}</Text>
      <ScrollView contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.row} activeOpacity={0.6} onPress={() => choose('system')}>
          <Text style={styles.rowLabel}>{t('language.system')}</Text>
          {preference === 'system' && <Text style={styles.rowCheck}>✓</Text>}
          <View style={styles.divider} />
        </TouchableOpacity>
        {SUPPORTED_LANGUAGES.map((lang, i) => (
          <TouchableOpacity key={lang.code} style={styles.row} activeOpacity={0.6} onPress={() => choose(lang.code)}>
            <Text style={styles.rowLabel}>{lang.nativeLabel}</Text>
            {preference === lang.code && <Text style={styles.rowCheck}>✓</Text>}
            {i < SUPPORTED_LANGUAGES.length - 1 && <View style={styles.divider} />}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16},
    backButton: {paddingTop: 8, paddingBottom: 4, alignSelf: 'flex-start'},
    title: {color: colors.textPrimary, fontSize: 34, fontWeight: '800', marginTop: 6, marginBottom: 8},
    rows: {paddingBottom: 32},
    row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, position: 'relative'},
    rowLabel: {flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '500'},
    rowCheck: {color: colors.navActive, fontSize: 16, fontWeight: '800'},
    divider: {position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, backgroundColor: colors.divider},
  });
}
