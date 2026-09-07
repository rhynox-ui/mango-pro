// src/debug/crashReporter.ts
//
// Temporary diagnostic, not a permanent feature: this app has no PC-based
// tester available to pull a real `adb logcat` trace, and a release build
// (unlike dev) shows no red error screen for an uncaught JS exception —
// it just force-closes silently, indistinguishable from a real native
// crash from the outside. This captures whatever JS-level crash detail
// IS available (global.ErrorUtils, RN's own uncaught-JS-exception hook)
// to AsyncStorage, so it survives the process dying, and App.tsx shows it
// on the very next launch — the same practical effect as a stack trace,
// without needing a computer.
//
// Deliberately does NOT catch native (Java/Kotlin/JNI) crashes — those
// happen below the JS bridge and are invisible to global.ErrorUtils. If
// a crash still shows nothing here after this is wired in, that's real
// evidence the failure is native-level, not a gap in this file.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'mango_pro_last_crash';

type StoredCrash = {message: string; stack: string; isFatal: boolean; at: number};

/** Installs the global JS crash hook — call once, as early as possible (index.js, before anything else runs). */
export function installCrashReporter(): void {
  const errorUtils = (global as {ErrorUtils?: {setGlobalHandler: (h: (e: Error, isFatal?: boolean) => void) => void; getGlobalHandler?: () => (e: Error, isFatal?: boolean) => void}}).ErrorUtils;
  if (!errorUtils) return;
  const previousHandler = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    const record: StoredCrash = {message: error?.message ?? String(error), stack: error?.stack ?? '', isFatal: Boolean(isFatal), at: Date.now()};
    // Fire-and-forget — this is a best-effort diagnostic aid, not
    // something that should itself ever risk making a crash worse by
    // throwing again while already handling one.
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record)).catch(() => {});
    previousHandler?.(error, isFatal);
  });
}

export async function readLastCrash(): Promise<StoredCrash | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredCrash) : null;
  } catch {
    return null;
  }
}

export async function clearLastCrash(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
