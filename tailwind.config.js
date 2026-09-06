// tailwind.config.js
//
// Colors are wired to CSS custom properties (src/index.css), not literal
// hex values here — the same LIGHT/DARK token pairs mango-mobile's own
// src/theme/palette.js already carries (itself a byte-matched port of
// mango-bridge.jsx's PALETTE.light/PALETTE.dark), so this app's colors
// stay in exact sync with the rest of the family rather than becoming a
// fourth, independently-drifting copy of the same values.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        panel: "var(--color-panel)",
        panelBorder: "var(--color-panel-border)",
        input: "var(--color-input)",
        pillBg: "var(--color-pill-bg)",
        textPrimary: "var(--color-text-primary)",
        textSecondary: "var(--color-text-secondary)",
        textMuted: "var(--color-text-muted)",
        divider: "var(--color-divider)",
        ctaBg: "var(--color-cta-bg)",
        ctaText: "var(--color-cta-text)",
        ctaDisabledBg: "var(--color-cta-disabled-bg)",
        ctaDisabledText: "var(--color-cta-disabled-text)",
        navActive: "var(--color-nav-active)",
        navActiveText: "var(--color-nav-active-text)",
        accent: "var(--color-accent)",
        accentDeep: "var(--color-accent-deep)",
        // danger/warning/gain/gainDeep are deliberately NOT theme-dependent
        // (same reasoning as palette.js's own header: danger/warning have
        // no light/dark variant, gain is a trading convention, not
        // branding) — defined once in :root, never overridden per-theme.
        danger: "var(--color-danger)",
        warning: "var(--color-warning)",
        gain: "var(--color-gain)",
        gainDeep: "var(--color-gain-deep)",
      },
      fontFamily: {
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
