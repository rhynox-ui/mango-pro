// src/theme/palette.ts
//
// Ported directly from mango-mobile's src/theme/palette.js, itself a
// byte-matched port of mango-bridge.jsx's own PALETTE.light/PALETTE.dark
// (src/theme.js there). Not re-derived — copied verbatim — so Mango Pro
// starts as a third correct copy of this design system, not a fourth
// place its hard-won rules (monochrome CTA that flips per theme, never a
// flat brand color; danger/warning/gain kept theme-independent) need to
// be re-litigated or drift from.
//
// applyPaletteToDocument() is this file's one real addition: it writes
// these values onto :root as CSS custom properties (see tailwind.config.js,
// which points its color tokens at exactly these variable names) so the
// same TypeScript objects below are both the source of truth AND what
// Tailwind classes like `bg-panel`/`text-textPrimary` actually resolve to
// — one place to edit a color, not two.

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

const CSS_VAR_NAME: Record<keyof Palette, string> = {
  bg: '--color-bg',
  panel: '--color-panel',
  panelBorder: '--color-panel-border',
  input: '--color-input',
  pillBg: '--color-pill-bg',
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  textMuted: '--color-text-muted',
  divider: '--color-divider',
  ctaBg: '--color-cta-bg',
  ctaText: '--color-cta-text',
  ctaDisabledBg: '--color-cta-disabled-bg',
  ctaDisabledText: '--color-cta-disabled-text',
  navActive: '--color-nav-active',
  navActiveText: '--color-nav-active-text',
  accent: '--color-accent',
  accentDeep: '--color-accent-deep',
  danger: '--color-danger',
  warning: '--color-warning',
  gain: '--color-gain',
  gainDeep: '--color-gain-deep',
};

export function applyPaletteToDocument(mode: 'light' | 'dark'): void {
  const palette = mode === 'dark' ? DARK : LIGHT;
  const root = document.documentElement;
  (Object.keys(palette) as (keyof Palette)[]).forEach(key => {
    root.style.setProperty(CSS_VAR_NAME[key], palette[key]);
  });
  root.classList.toggle('dark', mode === 'dark');
}
