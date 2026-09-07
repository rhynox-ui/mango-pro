// src/settings/BiometricContext.tsx
//
// Same App.tsx-owns-state, context-for-reads-and-writes shape as
// AutoLockContext — the real availability/enabled checks
// (isBiometricAvailable/isBiometricUnlockEnabled) run once in AuthGate,
// and SecurityScreen (reached through Settings) reads and toggles the
// same state through this rather than duplicating those checks itself.

import {createContext, useContext} from 'react';

type BiometricContextValue = {
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  biometryLabel: string;
  setBiometricEnabled: (enabled: boolean) => void;
};

export const BiometricContext = createContext<BiometricContextValue | null>(null);

export function useBiometric(): BiometricContextValue {
  const ctx = useContext(BiometricContext);
  if (!ctx) {
    throw new Error('useBiometric must be used within a BiometricContext.Provider');
  }
  return ctx;
}
