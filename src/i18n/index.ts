// src/i18n/index.ts
//
// Real language switching, built deliberately small in scope: the
// bottom tab bar and Settings screen are the first genuinely-translated
// surface, not a silent attempt to translate every string in this large
// app in one pass (see Language row's old comment in SettingsScreen.tsx
// for why it was left as an honest placeholder before this).
//
// i18next + react-i18next only — pure JS, no native module, no pod
// install / gradle rebuild. useTranslation() (react-i18next) already
// re-renders any component using it when the language changes, so no
// extra Context/Provider is needed here, unlike ThemeContext.tsx (which
// has to own re-rendering itself since it isn't backed by a library).
//
// "System" is a REAL device-locale read via react-native's own built-in
// I18nManager (already linked in every RN app, not an extra dependency)
// — not a fake default the way the old placeholder's hardcoded "System"
// value was. The actual resources + the locale-matching rule live in
// resources.ts, which deliberately has no react-native import so it can
// be exercised directly by scripts/verify-i18n.mjs with plain Node —
// this file is the thin wrapper adding the native/async pieces on top.
//
// Deliberately NOT doing RTL layout mirroring for Arabic here — that
// requires I18nManager.forceRTL + a full app reload and touches every
// screen's layout, a much larger and riskier change than having Arabic
// text. Arabic ships as a real translated language; RTL layout is a
// separate future task.

import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {I18nManager} from 'react-native';
import {resources, DEFAULT_LANGUAGE, languageForLocaleIdentifier, type LanguageCode} from './resources';

export {SUPPORTED_LANGUAGES, type LanguageCode} from './resources';

const STORAGE_KEY = 'mango_pro_language'; // 'system' or a LanguageCode

export function detectSystemLanguage(): LanguageCode {
  return languageForLocaleIdentifier(I18nManager.getConstants().localeIdentifier);
}

i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {escapeValue: false}, // React already escapes rendered text
});

/**
 * Call once at app startup (App.tsx). i18n.init above is synchronous
 * with all 5 languages' resources already loaded, so there's no blank
 * state to gate rendering on — this just switches to the real stored
 * preference (or a real system-detected one) once AsyncStorage
 * resolves, same "default now, correct itself after mount" pattern
 * ThemeContext.tsx already uses for theme mode.
 */
export async function initLanguage(): Promise<void> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  const code = stored && stored !== 'system' ? (stored as LanguageCode) : detectSystemLanguage();
  if (code !== i18n.language) await i18n.changeLanguage(code);
}

/** "system" persists as the OS-following mode (re-detected on every future launch); a specific code pins the app to that language regardless of device locale. */
export async function setLanguagePreference(choice: 'system' | LanguageCode): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, choice).catch(() => {
    // Storage unavailable — the choice just won't persist across
    // launches, nothing else breaks, same pattern as mobile's own
    // AsyncStorage writers.
  });
  await i18n.changeLanguage(choice === 'system' ? detectSystemLanguage() : choice);
}

/** What the Language row's value and the picker's checkmark should reflect — distinguishes "System" from an explicit pin even when both currently resolve to the same actual code. */
export async function getLanguagePreference(): Promise<'system' | LanguageCode> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  return stored === 'system' || !stored ? 'system' : (stored as LanguageCode);
}

export default i18n;
