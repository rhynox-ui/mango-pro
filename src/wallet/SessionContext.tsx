// src/wallet/SessionContext.tsx
//
// Holds the unlocked wallet's derived accounts in memory only — never
// persisted, never logged. Cleared on lock() or app restart (nothing
// here survives a process kill, by design: only the encrypted vault in
// AsyncStorage does).
//
// Auto-lock-on-background IS real now (a security/bug audit pass flagged
// this comment as stale and it was — fixed here rather than just the
// values elsewhere): App.tsx's own AppState-driven handler
// (autoLockMsRef/handleLock) clears this session after the configured
// grace period once the app is backgrounded, the same real enforcement
// mobile's own App.tsx has. This file doesn't own that logic itself —
// it just holds whatever App.tsx puts here — so the timer lives there,
// not duplicated into a second mechanism here.

import {createContext, useContext, useMemo, useState, type ReactNode} from 'react';
import type {DerivedAccounts} from './keys';

type SessionContextValue = {
  session: DerivedAccounts | null;
  setSession: (session: DerivedAccounts | null) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({children}: {children: ReactNode}) {
  const [session, setSession] = useState<DerivedAccounts | null>(null);
  const value = useMemo(() => ({session, setSession}), [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
