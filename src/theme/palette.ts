// src/theme/palette.ts
//
// LIGHT is still byte-matched to mango-mobile's own src/theme/palette.js
// (itself a port of mango-bridge.jsx's PALETTE.light) — the shared
// hard-won rules (monochrome CTA that flips per theme, never a flat
// brand color; danger/warning/gain kept theme-independent) still apply,
// and those three constants stay identical across all three apps on
// purpose.
//
// DARK is a deliberate Mango Pro-only deviation from that shared file,
// per explicit product feedback: the ported near-black (#0A0A0B) read
// as too dark on a real device. Shifted to a lighter, warm-neutral
// graphite (closer to a brushed carbon-fiber tone than a flat black)
// while keeping every existing contrast relationship intact — text on
// panel, panel on bg, CTA on bg all still resolve the same way, just
// against a brighter base.

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
  bg: '#1B1B1E',
  panel: '#242428',
  panelBorder: '#34343A',
  input: '#161619',
  pillBg: '#2A2A2F',
  textPrimary: '#F5F5F6',
  textSecondary: '#ACACB2',
  textMuted: '#75757C',
  divider: '#303035',
  ctaBg: '#F5F5F6',
  ctaText: '#0A0A0B',
  ctaDisabledBg: '#303035',
  ctaDisabledText: '#75757C',
  navActive: '#F5F5F6',
  navActiveText: '#0A0A0B',
  accent: '#F5F5F6',
  accentDeep: '#F5F5F6',
  danger: DANGER,
  warning: WARNING,
  gain: GAIN,
  gainDeep: GAIN_DEEP,
};
