// src/i18n/resources.ts
//
// Pure data + pure logic only — deliberately NO import of 'react-native'
// or any native module, so this (and therefore the actual translated
// strings) can be exercised directly by a plain Node script
// (scripts/verify-i18n.mjs) with no Metro/Babel transform and no
// device/emulator, the same reasoning src/core/solanaTxIntent.ts's own
// header gives for keeping its logic SDK-import-free. src/i18n/index.ts
// is the thin wrapper that adds the real react-native/AsyncStorage/
// i18next wiring on top of this.

export type LanguageCode = 'en' | 'zh' | 'es' | 'ar' | 'fr';

/** Native-script display names — shown in their OWN language regardless of the app's current language, same convention every real language picker uses (you can always find your language even if you can't read the current one). */
export const SUPPORTED_LANGUAGES: {code: LanguageCode; nativeLabel: string}[] = [
  {code: 'en', nativeLabel: 'English'},
  {code: 'zh', nativeLabel: '简体中文'},
  {code: 'es', nativeLabel: 'Español'},
  {code: 'ar', nativeLabel: 'العربية'},
  {code: 'fr', nativeLabel: 'Français'},
];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export const resources = {
  en: {
    translation: {
      tabs: {home: 'Home', search: 'Search', trade: 'Trade', profile: 'Profile'},
      settings: {
        title: 'Settings',
        profileAndAccount: 'Profile and Account',
        appearanceAndHaptics: 'Appearance and Haptics',
        language: 'Language',
        notifications: 'Notifications',
        security: 'Security',
        depositAndWithdraw: 'Deposit and Withdraw',
        legalAndPrivacy: 'Legal and Privacy',
        taxes: 'Taxes',
        helpAndSupport: 'Help and Support',
        documentation: 'Documentation',
        logOut: 'Log Out',
        deleteAccount: 'Delete Account',
      },
      language: {title: 'Language', system: 'System'},
    },
  },
  zh: {
    translation: {
      tabs: {home: '首页', search: '搜索', trade: '交易', profile: '我的'},
      settings: {
        title: '设置',
        profileAndAccount: '个人资料和账户',
        appearanceAndHaptics: '外观和触感反馈',
        language: '语言',
        notifications: '通知',
        security: '安全',
        depositAndWithdraw: '充值和提现',
        legalAndPrivacy: '法律和隐私',
        taxes: '税务',
        helpAndSupport: '帮助和支持',
        documentation: '文档',
        logOut: '退出登录',
        deleteAccount: '删除账户',
      },
      language: {title: '语言', system: '跟随系统'},
    },
  },
  es: {
    translation: {
      tabs: {home: 'Inicio', search: 'Buscar', trade: 'Operar', profile: 'Perfil'},
      settings: {
        title: 'Configuración',
        profileAndAccount: 'Perfil y cuenta',
        appearanceAndHaptics: 'Apariencia y vibración',
        language: 'Idioma',
        notifications: 'Notificaciones',
        security: 'Seguridad',
        depositAndWithdraw: 'Depositar y retirar',
        legalAndPrivacy: 'Legal y privacidad',
        taxes: 'Impuestos',
        helpAndSupport: 'Ayuda y soporte',
        documentation: 'Documentación',
        logOut: 'Cerrar sesión',
        deleteAccount: 'Eliminar cuenta',
      },
      language: {title: 'Idioma', system: 'Sistema'},
    },
  },
  ar: {
    translation: {
      tabs: {home: 'الرئيسية', search: 'بحث', trade: 'تداول', profile: 'الملف الشخصي'},
      settings: {
        title: 'الإعدادات',
        profileAndAccount: 'الملف الشخصي والحساب',
        appearanceAndHaptics: 'المظهر والاهتزاز اللمسي',
        language: 'اللغة',
        notifications: 'الإشعارات',
        security: 'الأمان',
        depositAndWithdraw: 'الإيداع والسحب',
        legalAndPrivacy: 'الشروط القانونية والخصوصية',
        taxes: 'الضرائب',
        helpAndSupport: 'المساعدة والدعم',
        documentation: 'التوثيق',
        logOut: 'تسجيل الخروج',
        deleteAccount: 'حذف الحساب',
      },
      language: {title: 'اللغة', system: 'النظام'},
    },
  },
  fr: {
    translation: {
      tabs: {home: 'Accueil', search: 'Rechercher', trade: 'Trading', profile: 'Profil'},
      settings: {
        title: 'Paramètres',
        profileAndAccount: 'Profil et compte',
        appearanceAndHaptics: 'Apparence et retour haptique',
        language: 'Langue',
        notifications: 'Notifications',
        security: 'Sécurité',
        depositAndWithdraw: 'Dépôt et retrait',
        legalAndPrivacy: 'Mentions légales et confidentialité',
        taxes: 'Impôts',
        helpAndSupport: 'Aide et support',
        documentation: 'Documentation',
        logOut: 'Déconnexion',
        deleteAccount: 'Supprimer le compte',
      },
      language: {title: 'Langue', system: 'Système'},
    },
  },
};

/**
 * Pure locale-string-matching rule, split out from detectSystemLanguage
 * (src/i18n/index.ts) specifically so it's testable without importing
 * react-native's I18nManager. Maps a device-reported locale identifier
 * (e.g. "zh_Hans_CN", "es_MX", "ar_SA", "en_US") to one of the 5
 * languages this app actually has translations for. Real detection
 * logic, not a guess — but honest about only covering these 5: anything
 * else falls back to English rather than pretending to support it.
 */
export function languageForLocaleIdentifier(localeIdentifier: string | null | undefined): LanguageCode {
  const raw = (localeIdentifier ?? '').toLowerCase();
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('ar')) return 'ar';
  if (raw.startsWith('fr')) return 'fr';
  return DEFAULT_LANGUAGE;
}
