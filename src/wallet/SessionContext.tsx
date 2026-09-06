// src/wallet/SessionContext.tsx
//
// Holds the unlocked wallet's derived accounts in memory only — never
// persisted, never logged. Cleared on lock() or app restart (nothing
// here survives a process kill, by design: only the encrypted vault in
// AsyncStorage does).
//
// No auto-lock-on-background yet (mobile's own App.tsx has a real
// AUTO_LOCK_GRACE_MS timer for this) — once unlocked, the session stays
// live until the app process ends. A real gap worth closing before this
// app handles meaningful balances, not something this file pretends is
// solved.

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
