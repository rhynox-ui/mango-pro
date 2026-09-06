// src/theme/palette.ts
//
// Ported directly from mango-mobile's own src/theme/palette.js (itself a
// byte-matched port of mango-bridge.jsx's PALETTE.light/PALETTE.dark) —
// not re-derived, copied verbatim, so this stays a correct third copy of
// the design system rather than a fourth place its hard-won rules
// (monochrome CTA that flips per theme, never a flat brand color;
// danger/warning/gain kept theme-independent) can quietly drift from.

export const DANGER = '#D92D20';
export const WARNING = '#EAB308';
export const GAIN = '#00D67D';
export const GAIN_DEEP = '#00A863';

export type Palette = {
  bg: string;
  panel: string;
  panelBorder: string;
  input: string;
  pillBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  divider: string;
  ctaBg: string;
  ctaText: string;
  ctaDisabledBg: string;
  ctaDisabledText: string;
  navActive: string;
  navActiveText: string;
  accent: string;
  accentDeep: string;
  danger: string;
  warning: string;
  gain: string;
  gainDeep: string;
};

export const LIGHT: Palette = {
  bg: '#FFFFFF',
  panel: '#F6F6F7',
  panelBorder: '#E6E6E8',
  input: '#EAEAED',
  pillBg: '#EFEFF0',
  textPrimary: '#0A0A0B',
  textSecondary: '#6B6B70',
  textMuted: '#A6A6AC',
  divider: '#EDEDEF',
  ctaBg: '#0A0A0B',
  ctaText: '#FFFFFF',
  ctaDisabledBg: '#EDEDEF',
  ctaDisabledText: '#B8B8BC',
  navActive: '#0A0A0B',
  navActiveText: '#FFFFFF',
  accent: '#0A0A0B',
  accentDeep: '#0A0A0B',
  danger: DANGER,
  warning: WARNING,
  gain: GAIN,
  gainDeep: GAIN_DEEP,
};

export const DARK: Palette = {
  bg: '#0A0A0B',
  panel: '#151517',
  panelBorder: '#232326',
  input: '#060608',
  pillBg: '#1F1F22',
  textPrimary: '#F5F5F6',
  textSecondary: '#9A9AA0',
  textMuted: '#57575D',
  divider: '#1D1D20',
  ctaBg: '#F5F5F6',
  ctaText: '#0A0A0B',
  ctaDisabledBg: '#1D1D20',
  ctaDisabledText: '#57575D',
  navActive: '#F5F5F6',
  navActiveText: '#0A0A0B',
  accent: '#F5F5F6',
  accentDeep: '#F5F5F6',
  danger: DANGER,
  warning: WARNING,
  gain: GAIN,
  gainDeep: GAIN_DEEP,
};
