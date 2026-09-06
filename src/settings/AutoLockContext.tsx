// src/settings/AutoLockContext.tsx
//
// Exposes the auto-lock preference (and its setter) to whatever's
// rendered once unlocked — the real AppState listener that enforces it
// lives in App.tsx's AuthGate, which owns authState/session and so is
// the only place that can actually lock the app; this context is just
// how a screen nested deep under it (SecurityScreen, reached through
// Settings) reads and changes the same value, same App.tsx-owns-state,
// context-for-reads-and-writes shape SessionContext already establishes
// in this codebase.

import {createContext, useContext} from 'react';

type AutoLockContextValue = {
  autoLockMs: number;
  setAutoLockMs: (ms: number) => void;
};

export const AutoLockContext = createContext<AutoLockContextValue | null>(null);

export function useAutoLock(): AutoLockContextValue {
  const ctx = useContext(AutoLockContext);
  if (!ctx) {
    throw new Error('useAutoLock must be used within an AutoLockContext.Provider');
  }
  return ctx;
}
