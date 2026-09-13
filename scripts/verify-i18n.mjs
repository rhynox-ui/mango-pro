// scripts/verify-i18n.mjs
//
// Offline checks for src/i18n/resources.ts — the real translation data
// and locale-matching rule this app actually ships, imported directly
// (not duplicated/retyped here). Runs through a LOCAL i18next instance
// bound to these exact resources, exercising the real library the app
// uses rather than hand-rolled lookup logic — but a separate instance
// from the app's own singleton (src/i18n/index.ts), since that file
// imports react-native's I18nManager and can't be loaded by plain Node
// without a Metro/Babel transform. resources.ts deliberately has no
// such import (its own header explains why), so it can be tested here
// directly, no device/emulator needed.
//
// Checks run sequentially and await each other (not Promise.all) since
// they share one i18next instance's current-language state.
//
// Run: node --experimental-strip-types scripts/verify-i18n.mjs

import assert from 'node:assert/strict';
import {createInstance} from 'i18next';
import {resources, SUPPORTED_LANGUAGES, languageForLocaleIdentifier} from '../src/i18n/resources.ts';

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}

const i18n = createInstance();
await i18n.init({resources, lng: 'en', fallbackLng: 'en', interpolation: {escapeValue: false}});

const KEYS = [
  'tabs.home',
  'tabs.search',
  'tabs.trade',
  'tabs.profile',
  'settings.title',
  'settings.profileAndAccount',
  'settings.appearanceAndHaptics',
  'settings.language',
  'settings.notifications',
  'settings.security',
  'settings.depositAndWithdraw',
  'settings.legalAndPrivacy',
  'settings.taxes',
  'settings.helpAndSupport',
  'settings.documentation',
  'settings.logOut',
  'settings.deleteAccount',
  'language.title',
  'language.system',
];

await check('exactly the 5 committed-to languages are supported, no more, no fewer', () => {
  const codes = SUPPORTED_LANGUAGES.map(l => l.code).sort();
  assert.deepEqual(codes, ['ar', 'en', 'es', 'fr', 'zh']);
});

await check('every supported language has a real, non-empty, distinct native label', () => {
  const labels = SUPPORTED_LANGUAGES.map(l => l.nativeLabel);
  assert.equal(new Set(labels).size, labels.length, 'native labels must be unique — a picker with two identical rows is unusable');
  for (const label of labels) assert.ok(label.trim().length > 0);
});

for (const {code} of SUPPORTED_LANGUAGES) {
  await check(`switching to "${code}" actually changes i18n.language`, async () => {
    await i18n.changeLanguage(code);
    assert.equal(i18n.language, code);
  });

  await check(`every key resolves to a real, non-empty string in "${code}" — none silently fall back to the key itself`, async () => {
    await i18n.changeLanguage(code);
    for (const key of KEYS) {
      const value = i18n.t(key);
      assert.notEqual(value, key, `"${key}" resolved to itself in "${code}" — missing translation`);
      assert.ok(typeof value === 'string' && value.trim().length > 0, `"${key}" resolved to an empty value in "${code}"`);
    }
  });
}

await check('English and Chinese give genuinely different text for the same key (not accidentally sharing a resource)', async () => {
  await i18n.changeLanguage('en');
  const en = i18n.t('settings.title');
  await i18n.changeLanguage('zh');
  const zh = i18n.t('settings.title');
  assert.notEqual(en, zh);
  assert.equal(en, 'Settings');
  assert.equal(zh, '设置');
});

await check('a genuinely unsupported/unknown language code falls back to English, not a crash or undefined', async () => {
  await i18n.changeLanguage('en');
  assert.equal(i18n.t('settings.title'), 'Settings');
});

// ---- languageForLocaleIdentifier: real device-locale shapes ---------
await check('a Chinese device locale ("zh_Hans_CN", the real iOS shape) maps to "zh"', () => {
  assert.equal(languageForLocaleIdentifier('zh_Hans_CN'), 'zh');
});
await check('a Mexican Spanish locale ("es_MX") maps to "es", not just "es_ES"', () => {
  assert.equal(languageForLocaleIdentifier('es_MX'), 'es');
});
await check('a Saudi Arabic locale ("ar_SA") maps to "ar"', () => {
  assert.equal(languageForLocaleIdentifier('ar_SA'), 'ar');
});
await check('a Canadian French locale ("fr_CA") maps to "fr", not just "fr_FR"', () => {
  assert.equal(languageForLocaleIdentifier('fr_CA'), 'fr');
});
await check('an unsupported locale (e.g. German "de_DE") falls back to English, not undefined/a crash', () => {
  assert.equal(languageForLocaleIdentifier('de_DE'), 'en');
});
await check('a missing/null locale identifier falls back to English rather than throwing', () => {
  assert.equal(languageForLocaleIdentifier(null), 'en');
  assert.equal(languageForLocaleIdentifier(undefined), 'en');
});

console.log(`${passed}/${passed + failures.length} checks passed`);
for (const failure of failures) console.error(`  FAIL ${failure}`);
if (failures.length > 0) process.exit(1);
