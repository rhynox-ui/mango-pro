// src/settings/AuthActionsContext.tsx
//
// Same App.tsx-owns-state, context-for-reads-and-writes shape as
// AutoLockContext — AuthGate already has a real handleLock() (used by
// its own auto-lock timer), but nothing let a user trigger it on
// demand: there was no "Log out" anywhere in the app. This exposes it
// to whatever's rendered once unlocked (SettingsScreen, reached through
// Settings), the same way AutoLockContext exposes the auto-lock
// preference to SecurityScreen.
//
// deleteWallet resets app-level auth state AFTER SettingsScreen has
// already called clearVault() itself, behind its own real backup-
// confirmation UI — this context only ever does the post-wipe
// navigation, never the wipe itself, so the destructive call and its
// confirmation gate live in exactly one place.

import {createContext, useContext} from 'react';

type AuthActionsContextValue = {
  logout: () => void;
  deleteWallet: () => void;
};

export const AuthActionsContext = createContext<AuthActionsContextValue | null>(null);

export function useAuthActions(): AuthActionsContextValue {
  const ctx = useContext(AuthActionsContext);
  if (!ctx) {
    throw new Error('useAuthActions must be used within an AuthActionsContext.Provider');
  }
  return ctx;
}
