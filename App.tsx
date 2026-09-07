/**
 * Mango Pro — mobile app entry point.
 *
 * Two state machines stacked: an auth gate (loading -> welcome/create/
 * import or locked -> unlocked) in front of the four-tab app (Home,
 * Search, Swap, Profile), same screen-switch pattern as mango-mobile's
 * own App.tsx rather than a navigation library. Settings is a pushed
 * screen reached from Profile's own gear icon, not a tab.
 *
 * The reference nav this was built against has a fifth tab, Community
 * (following, leaderboards, copy-trade discovery) — deliberately not
 * carried over. Mango Pro has no social layer to put behind it yet, and
 * shipping a tab that only opens a placeholder is the same kind of
 * fabrication this app avoids everywhere else (see ProfileScreen's own
 * "Coming soon" pills for the honest way to flag an unbuilt feature —
 * a whole nav destination going nowhere isn't that). Four real tabs
 * beats five where one is empty.
 *
 * @format
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {AppState, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ThemeProvider, useTheme, type Colors} from './src/theme/ThemeContext';
import {SessionProvider, useSession} from './src/wallet/SessionContext';
import {deriveAccounts, warmupCrypto} from './src/wallet/keys';
import {createVault, hasVault, loadVault, unlockVaultMnemonic} from './src/wallet/vault';
import {loginWithGoogle, logoutParticle, particleAddressesToSession, tryRestoreParticleSession} from './src/wallet/particleAuth';
import {clearLastCrash, readLastCrash} from './src/debug/crashReporter';
import {AutoLockContext} from './src/settings/AutoLockContext';
import {AuthActionsContext} from './src/settings/AuthActionsContext';
import {BiometricContext} from './src/settings/BiometricContext';
import {DEFAULT_AUTO_LOCK_MS, loadAutoLockMs, setAutoLockMs as persistAutoLockMs} from './src/settings/autoLockPrefs';
import {getBiometricPassword, getBiometryLabel, isBiometricAvailable, isBiometricUnlockEnabled} from './src/wallet/biometricAuth';
import {isAppLockEnabled, verifyAppLock} from './src/wallet/appLockAuth';
import {RecommendBiometricModal} from './src/wallet/RecommendBiometricModal';
import {WelcomeScreen} from './src/onboarding/WelcomeScreen';
import {CreateWalletFlow} from './src/onboarding/CreateWalletFlow';
import {ImportWalletFlow} from './src/onboarding/ImportWalletFlow';
import {LockedScreen} from './src/onboarding/LockedScreen';
import {AppLockScreen} from './src/onboarding/AppLockScreen';
import {IntroSplash} from './src/onboarding/IntroSplash';
import {TabIcon, type TabIconName} from './src/navigation/TabIcon';
import {HomeScreen} from './src/screens/HomeScreen';
import {SearchScreen} from './src/screens/SearchScreen';
import {TokenTradeScreen, type DemoToken} from './src/screens/TokenTradeScreen';
import {ProfileScreen} from './src/screens/ProfileScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {HistoryScreen} from './src/screens/HistoryScreen';
import type {TokenSearchResult} from './src/core/tokenSearch';
import type {DiscoveryToken} from './src/core/discoveryFeed';

type Tab = 'home' | 'search' | 'swap' | 'profile';
type Screen = 'tabs' | 'settings' | 'history';
type AuthState = 'loading' | 'welcome' | 'create' | 'import' | 'locked' | 'app-locked' | 'unlocked';

const TABS: {key: Tab; label: string; icon: TabIconName}[] = [
  {key: 'home', label: 'Home', icon: 'home'},
  {key: 'search', label: 'Search', icon: 'search'},
  {key: 'swap', label: 'Swap', icon: 'swap'},
  {key: 'profile', label: 'Profile', icon: 'profile'},
];

function AuthGate({children}: {children: React.ReactNode}): React.JSX.Element {
  const {colors} = useTheme();
  const {session, setSession} = useSession();
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometryLabel, setBiometryLabel] = useState('biometric');
  // Google/Particle-session app-lock — see appLockAuth.ts's own header
  // for why this is a separate mechanism from biometricEnabled above.
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  // Only ever shown once, right after finishOnboarding (Create or
  // Import) — never on a returning user's unlock. Holds the just-typed
  // password in memory only long enough for a same-screen "Enable" tap
  // to use it; cleared as soon as the modal closes either way.
  const [showRecommendBiometric, setShowRecommendBiometric] = useState(false);
  const freshPasswordRef = useRef('');
  // Determines the post-intro screen AND which intro to play at all —
  // IntroSplash isn't mounted until this resolves (a fast AsyncStorage
  // read, not the deliberate animation), so a returning user gets the
  // short `quick` intro from the very first frame instead of always
  // sitting through the full ~6s brand moment meant for first-time
  // installs. Same reasoning as mango-mobile's own App.tsx.
  const nextAuthStateAfterIntroRef = useRef<AuthState>('welcome');
  const [vaultChecked, setVaultChecked] = useState(false);

  useEffect(() => {
    // Best-effort, deferred: warms the secp256k1/ed25519 precomputation
    // so it isn't paid synchronously at onboarding handoff (see keys.ts's
    // own comment on why that timing matters).
    const timer = setTimeout(warmupCrypto, 0);
    // Deliberately NOT calling initParticleAuth() unconditionally here.
    // It used to run eagerly on every app launch as a warmup (so the
    // first real tap of "Continue with Google" wouldn't also pay init's
    // cost), but that means Particle's native SDK — never proven to
    // actually initialize on a real device, only proven to compile —
    // ran unconditionally for every user, including the ones who never
    // touch Google login at all. If that native init fails hard (a
    // JNI-level crash, not a JS exception initParticleAuth's own
    // try/catch could ever catch), it takes down the whole app before
    // anything renders. tryRestoreParticleSession() below only touches
    // Particle's SDK at all for someone who has actually used Google
    // login before (its own header explains the gate) — that's the same
    // safety property this comment used to describe, just no longer
    // "never on cold start", since that was the real bug behind
    // "Google login doesn't persist, kicks me back to Welcome":
    // hasVault() alone (a LOCAL seed-phrase vault) never had a way to
    // know a Google session existed at all.
    hasVault().then(async exists => {
      if (exists) {
        nextAuthStateAfterIntroRef.current = 'locked';
        setVaultChecked(true);
        return;
      }
      const restored = await tryRestoreParticleSession();
      if (restored) {
        setSession(particleAddressesToSession(restored));
        // Real bug this closes: app-lock (Security screen's "Require
        // Face ID to reopen" toggle for Google sessions) only ever got
        // enforced from handleLock — a backgrounded-then-resumed app, or
        // an explicit lock. A cold start restoring a session here never
        // consulted it at all, so a user who turned app-lock on still
        // landed straight on 'unlocked' after force-quitting and
        // reopening the app — the exact case app-lock exists for.
        // Checked directly here (not via the separate appLockEnabled
        // state above, which is set by its own independent, unawaited
        // isAppLockEnabled() call and isn't guaranteed to have resolved
        // by this point) so this decision never races that one.
        const lockEnabled = await isAppLockEnabled();
        nextAuthStateAfterIntroRef.current = lockEnabled ? 'app-locked' : 'unlocked';
      } else {
        nextAuthStateAfterIntroRef.current = 'welcome';
      }
      setVaultChecked(true);
    });
    isBiometricAvailable().then(setBiometricAvailable);
    isBiometricUnlockEnabled().then(setBiometricEnabled);
    isAppLockEnabled().then(setAppLockEnabled);
    getBiometryLabel().then(setBiometryLabel);
    return () => clearTimeout(timer);
    // setSession is a stable context setter (SessionContext's own
    // useState setter) — listed to satisfy the lint rule, not because
    // this mount-only effect should ever actually re-run on it changing.
  }, [setSession]);

  async function handleGoogleLogin() {
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      const addresses = await loginWithGoogle();
      setSession(particleAddressesToSession(addresses));
      setAuthState('unlocked');
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setGoogleLoading(false);
    }
  }

  // Real gap this closes: unlocking derived a live private key into
  // session state with nothing that ever cleared it again short of a
  // full app kill — no lock-on-background at all, unlike mango-mobile's
  // own AppState-driven timer. autoLockMsRef mirrors autoLockMs state
  // (kept for the Security screen's own display) so the AppState
  // listener below always reads the current setting without needing to
  // resubscribe every time it changes.
  const [autoLockMs, setAutoLockMsState] = useState(DEFAULT_AUTO_LOCK_MS);
  const autoLockMsRef = useRef(DEFAULT_AUTO_LOCK_MS);

  useEffect(() => {
    loadAutoLockMs().then(ms => {
      autoLockMsRef.current = ms;
      setAutoLockMsState(ms);
    });
  }, []);

  function handleAutoLockChange(ms: number) {
    autoLockMsRef.current = ms;
    setAutoLockMsState(ms);
    persistAutoLockMs(ms);
  }

  const handleLock = useCallback(() => {
    const wasGoogleSession = session?.authMethod === 'google';
    // App-lock enabled: gate access with biometrics instead of a full
    // sign-out. Nothing sensitive to clear either way — a Google
    // session's own `session` value is just addresses (Particle's MPC
    // network holds the real key, never this device, per
    // particleAuth.ts's own header), so keeping it in memory across this
    // gate costs nothing and avoids a real network re-auth on unlock.
    if (wasGoogleSession && appLockEnabled) {
      setAuthState('app-locked');
      return;
    }
    // A Google-login session with app-lock OFF has no local
    // vault/password to unlock against — sending it to the
    // password-prompt LockedScreen would strand the user there with
    // nothing to type. Sign them out entirely instead; loginWithGoogle()
    // on the next "Continue with Google" tap resolves fast if Particle's
    // own SDK still has a live native session, same as any
    // "silently re-authenticate" pattern.
    setSession(null);
    if (wasGoogleSession) {
      logoutParticle();
      setAuthState('welcome');
    } else {
      setAuthState('locked');
    }
  }, [session, setSession, appLockEnabled]);

  /** Resolves true/false rather than throwing — AppLockScreen shows its own error copy on false, nothing to catch. */
  async function handleAppLockUnlock(): Promise<boolean> {
    const ok = await verifyAppLock();
    if (ok) setAuthState('unlocked');
    return ok;
  }

  function handleAppLockLogout() {
    setSession(null);
    logoutParticle();
    setAuthState('welcome');
  }

  // Same shape as mango-mobile's own App.tsx: record when the app left
  // 'active', and on returning to 'active' lock only if enough time
  // passed AND the app was actually unlocked when it backgrounded (no
  // point locking an already-locked or still-onboarding screen).
  const backgroundedAt = useRef<number | null>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        if (backgroundedAt.current !== null) {
          const elapsed = Date.now() - backgroundedAt.current;
          backgroundedAt.current = null;
          if (elapsed >= autoLockMsRef.current && authState === 'unlocked') {
            handleLock();
          }
        }
      } else if (backgroundedAt.current === null) {
        backgroundedAt.current = Date.now();
      }
    });
    return () => subscription.remove();
  }, [authState, handleLock]);

  async function finishOnboarding(mnemonic: string, password: string) {
    const accounts = deriveAccounts(mnemonic);
    await createVault(mnemonic, password);
    setSession(accounts);
    setAuthState('unlocked');
    if (biometricAvailable && !biometricEnabled) {
      freshPasswordRef.current = password;
      setShowRecommendBiometric(true);
    }
  }

  async function unlock(password: string) {
    const vault = await loadVault();
    if (!vault) {
      // The vault was cleared (or never existed) between the lock check
      // and this call — send back to onboarding rather than looping on
      // an unlock screen that can never succeed.
      setAuthState('welcome');
      return;
    }
    const mnemonic = await unlockVaultMnemonic(vault, password);
    setSession(deriveAccounts(mnemonic));
    setAuthState('unlocked');
  }

  async function handleBiometricUnlock() {
    const password = await getBiometricPassword();
    if (!password) {
      throw new Error('Biometric unlock was cancelled.');
    }
    await unlock(password);
  }

  function handleIntroDone() {
    setAuthState(nextAuthStateAfterIntroRef.current);
  }

  if (authState === 'loading') {
    if (!vaultChecked) {
      return <View style={[styles.loadingScreen, {backgroundColor: colors.bg}]} />;
    }
    // Quick intro for any returning user — a seed session going to
    // LockedScreen, or a Google session silently restored straight to
    // 'unlocked' by tryRestoreParticleSession() above. Only a genuine
    // first install (still 'welcome') gets the full ~6s brand moment.
    return <IntroSplash onDone={handleIntroDone} quick={nextAuthStateAfterIntroRef.current !== 'welcome'} />;
  }
  if (authState === 'welcome') {
    return (
      <WelcomeScreen
        onCreate={() => setAuthState('create')}
        onImport={() => setAuthState('import')}
        onGoogleLogin={handleGoogleLogin}
        googleLoading={googleLoading}
        googleError={googleError}
      />
    );
  }
  if (authState === 'create') {
    return <CreateWalletFlow onFinish={finishOnboarding} onCancel={() => setAuthState('welcome')} />;
  }
  if (authState === 'import') {
    return <ImportWalletFlow onFinish={finishOnboarding} onCancel={() => setAuthState('welcome')} />;
  }
  if (authState === 'locked') {
    return <LockedScreen onUnlock={unlock} biometricEnabled={biometricEnabled} biometryLabel={biometryLabel} onBiometricUnlock={handleBiometricUnlock} />;
  }
  if (authState === 'app-locked') {
    return <AppLockScreen onUnlock={handleAppLockUnlock} onLogout={handleAppLockLogout} biometryLabel={biometryLabel} />;
  }
  return (
    <AutoLockContext.Provider value={{autoLockMs, setAutoLockMs: handleAutoLockChange}}>
      <AuthActionsContext.Provider value={{logout: handleLock}}>
        <BiometricContext.Provider value={{biometricAvailable, biometricEnabled, biometryLabel, setBiometricEnabled, appLockEnabled, setAppLockEnabled}}>
          {children}
          <RecommendBiometricModal
            visible={showRecommendBiometric}
            biometryLabel={biometryLabel}
            password={freshPasswordRef.current}
            onDone={enabled => {
              setBiometricEnabled(enabled);
              setShowRecommendBiometric(false);
              freshPasswordRef.current = '';
            }}
          />
        </BiometricContext.Provider>
      </AuthActionsContext.Provider>
    </AutoLockContext.Provider>
  );
}

// Temporary diagnostic screen — see crashReporter.ts's own header. Shown
// once, on the launch right after a JS-level crash, so it can be
// screenshotted without needing a computer; "Dismiss" clears it and
// continues into the normal app.
function CrashReportScreen({crash, onDismiss}: {crash: {message: string; stack: string; isFatal: boolean; at: number}; onDismiss: () => void}): React.JSX.Element {
  return (
    <View style={crashStyles.root}>
      <Text style={crashStyles.title}>App crashed last time</Text>
      <ScrollView style={crashStyles.scroll}>
        <Text selectable style={crashStyles.meta}>{new Date(crash.at).toLocaleString()} · {crash.isFatal ? 'fatal' : 'non-fatal'}</Text>
        <Text selectable style={crashStyles.message}>{crash.message}</Text>
        <Text selectable style={crashStyles.stack}>{crash.stack}</Text>
      </ScrollView>
      <TouchableOpacity onPress={onDismiss} style={crashStyles.dismissButton}>
        <Text style={crashStyles.dismissLabel}>Dismiss</Text>
      </TouchableOpacity>
    </View>
  );
}

const crashStyles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#1a0000', paddingTop: 48, paddingHorizontal: 16},
  title: {color: '#ff6b6b', fontSize: 18, fontWeight: '700', marginBottom: 12},
  scroll: {flex: 1},
  meta: {color: '#ffffff', fontSize: 13, marginBottom: 8},
  message: {color: '#ffdddd', fontSize: 14, fontWeight: '600', marginBottom: 8},
  stack: {color: '#ffbbbb', fontSize: 11, fontFamily: 'monospace'},
  dismissButton: {marginVertical: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#330000', borderRadius: 8},
  dismissLabel: {color: '#ffffff', fontWeight: '700'},
});

function AppInner(): React.JSX.Element {
  const {colors, mode} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('home');
  const [screen, setScreen] = useState<Screen>('tabs');
  const [selectedToken, setSelectedToken] = useState<DemoToken | undefined>(undefined);
  const [lastCrash, setLastCrash] = useState<{message: string; stack: string; isFatal: boolean; at: number} | null>(null);
  // Settings' "Deposit and Withdraw" row used to just switch to the
  // Profile tab and leave the user to find the withdraw button
  // themselves — landed on the dashboard with no obvious next step,
  // which read as "this row does nothing real." This tells
  // ProfileScreen to open its own real withdraw modal the moment it
  // mounts from that specific navigation, without duplicating any of
  // its modal state up here.
  const [pendingProfileAction, setPendingProfileAction] = useState<'withdraw' | null>(null);

  useEffect(() => {
    readLastCrash().then(setLastCrash);
  }, []);

  function dismissCrashReport() {
    clearLastCrash();
    setLastCrash(null);
  }

  const showingSettings = screen === 'settings';
  const showingHistory = screen === 'history';
  const showingPushedScreen = showingSettings || showingHistory;
  const openSettings = () => setScreen('settings');
  const openHistory = () => setScreen('history');
  // Settings' own "Deposit and Withdraw" row has no dedicated screen of
  // its own — Profile already IS that real destination (the totalCash
  // row's +/- buttons), so this takes the user there AND tells it to
  // open the real Withdraw modal immediately, rather than landing on
  // the dashboard and leaving the user to find the button themselves.
  const goToWalletActions = () => {
    setScreen('tabs');
    setTab('profile');
    setPendingProfileAction('withdraw');
  };
  // Settings' "Profile and Account" row has no dedicated screen either —
  // Profile already covers address/account identity, so this just takes
  // the user there, same reasoning as goToWalletActions above minus the
  // pending-action handoff (there's no extra step to open once there).
  const goToProfile = () => {
    setScreen('tabs');
    setTab('profile');
  };

  function selectSearchResult(result: TokenSearchResult) {
    setSelectedToken({chainKey: result.chainKey, address: result.tokenAddress, symbol: result.symbol, imageUrl: result.imageUrl});
    setTab('swap');
  }

  function selectDiscoveryToken(token: DiscoveryToken) {
    setSelectedToken({chainKey: token.chainKey, address: token.tokenAddress, symbol: token.symbol, imageUrl: token.imageUrl});
    setTab('swap');
  }

  if (lastCrash) {
    return <CrashReportScreen crash={lastCrash} onDismiss={dismissCrashReport} />;
  }

  return (
    <SafeAreaProvider>
      {/* backgroundColor is gone from RN 0.87's StatusBar types — recent
          Android versions enforce edge-to-edge display, where the status
          bar is transparent over app content rather than a colored strip
          the app paints. barStyle (icon color) is what's left to control. */}
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
        <AuthGate>
          <View style={styles.body}>
            {showingSettings ? (
              <SettingsScreen onBack={() => setScreen('tabs')} onOpenDepositWithdraw={goToWalletActions} onOpenProfile={goToProfile} />
            ) : showingHistory ? (
              <HistoryScreen onBack={() => setScreen('tabs')} />
            ) : tab === 'home' ? (
              <HomeScreen onOpenSettings={openSettings} onSelectToken={selectDiscoveryToken} />
            ) : tab === 'search' ? (
              <SearchScreen onSelectToken={selectSearchResult} />
            ) : tab === 'swap' ? (
              <TokenTradeScreen
                token={selectedToken}
                onOpenSearch={() => setTab('search')}
                onBack={
                  selectedToken
                    ? () => {
                        setSelectedToken(undefined);
                        setTab('search');
                      }
                    : undefined
                }
              />
            ) : (
              <ProfileScreen
                onOpenSettings={openSettings}
                onOpenHistory={openHistory}
                pendingAction={pendingProfileAction}
                onPendingActionHandled={() => setPendingProfileAction(null)}
              />
            )}
          </View>

          {!showingPushedScreen && (
            <View style={styles.tabBar}>
              {TABS.map(t => {
                const active = tab === t.key;
                return (
                  <TouchableOpacity key={t.key} style={styles.tabItem} onPress={() => setTab(t.key)} activeOpacity={0.7}>
                    <TabIcon name={t.icon} color={active ? colors.navActive : colors.textMuted} size={20} />
                    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </AuthGate>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {flex: 1, alignItems: 'center', justifyContent: 'center'},
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: {flex: 1, backgroundColor: colors.bg},
    body: {flex: 1},
    tabBar: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: colors.panelBorder,
      backgroundColor: colors.panel,
    },
    tabItem: {flex: 1, paddingVertical: 10, alignItems: 'center', gap: 4},
    tabLabel: {color: colors.textMuted, fontSize: 12.5, fontWeight: '600'},
    tabLabelActive: {color: colors.navActive},
  });
}

export default function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <SessionProvider>
        <AppInner />
      </SessionProvider>
    </ThemeProvider>
  );
}
