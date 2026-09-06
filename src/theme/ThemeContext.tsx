// src/theme/ThemeContext.tsx
//
// Same shape as mango-mobile's own ThemeContext.tsx on purpose (useTheme()
// -> {mode, colors, setMode, toggleMode}) so a developer moving between
// the two codebases finds the identical pattern. Persistence uses
// localStorage (mobile uses AsyncStorage for the same reason — Hermes has
// none) under the same key concept the site/mobile already use
// ("mango:theme" / "mango_theme_mode"), and additionally calls
// applyPaletteToDocument() on every change so Tailwind's CSS-variable-
// backed color classes (bg-panel, text-textPrimary, etc.) stay in sync
// with whichever palette object components read via useTheme().colors —
// one state change updates both the React tree and the raw CSS.

import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import {applyPaletteToDocument, DARK, LIGHT} from './palette';

export type ThemeMode = 'light' | 'dark';
export type Colors = typeof LIGHT;

const STORAGE_KEY = 'mango_pro_theme_mode';

type ThemeContextValue = {
  mode: ThemeMode;
  colors: Colors;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      setModeState(stored);
    }
  }, []);

  useEffect(() => {
    applyPaletteToDocument(mode);
  }, [mode]);

  function setMode(next: ThemeMode) {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private browsing, quota) — the choice just
      // won't persist across sessions, nothing else breaks.
    }
  }

  function toggleMode() {
    setMode(mode === 'light' ? 'dark' : 'light');
  }

  const colors = mode === 'light' ? LIGHT : DARK;
  const value = useMemo(
    () => ({mode, colors, setMode, toggleMode}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, colors],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
