// src/theme/ThemeContext.tsx
//
// Ported directly from mango-mobile's own src/theme/ThemeContext.tsx —
// same shape (AsyncStorage-persisted mode, colors re-render everything
// live on toggle, defaults to light on a device with no stored
// preference yet). Own storage key so switching themes in Mango Pro
// never reads/writes mobile's separate AsyncStorage entry, even though
// both apps could theoretically end up installed side by side one day.

import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {DARK, LIGHT} from './palette';

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
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored === 'light' || stored === 'dark') {
        setModeState(stored);
      }
    });
  }, []);

  function setMode(next: ThemeMode) {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Storage unavailable — the choice just won't persist across
      // launches, nothing else breaks, same pattern as mobile's own
      // AsyncStorage writers.
    });
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
