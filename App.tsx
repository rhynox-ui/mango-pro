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
import {ActivityIndicator, AppState, StatusBar, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ThemeProvider, useTheme, type Colors} from './src/theme/ThemeContext';
import {SessionProvider, useSession} from './src/wallet/SessionContext';
import {deriveAccounts, warmupCrypto} from './src/wallet/keys';
import {createVault, hasVault, loadVault, unlockVaultMnemonic} from './src/wallet/vault';
import {initParticleAuth, loginWithGoogle, logoutParticle, particleAddressesToSession} from './src/wallet/particleAuth';
import {AutoLockContext} from './src/settings/AutoLockContext';
import {DEFAULT_AUTO_LOCK_MS, loadAutoLockMs, setAutoLockMs as persistAutoLockMs} from './src/settings/autoLockPrefs';
import {WelcomeScreen} from './src/onboarding/WelcomeScreen';
import {CreateWalletFlow} from './src/onboarding/CreateWalletFlow';
import {ImportWalletFlow} from './src/onboarding/ImportWalletFlow';
import {LockedScreen} from './src/onboarding/LockedScreen';
import {TabIcon, type TabIconName} from './src/navigation/TabIcon';
import {HomeScreen} from './src/screens/HomeScreen';
import {SearchScreen} from './src/screens/SearchScreen';
import {TokenTradeScreen, type DemoToken} from './src/screens/TokenTradeScreen';
import {ProfileScreen} from './src/screens/ProfileScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {HistoryScreen} from './src/screens/HistoryScreen';
import type {TokenSearchResult} from './src/core/tokenSearch';

type Tab = 'home' | 'search' | 'swap' | 'profile';
type Screen = 'tabs' | 'settings' | 'history';
type AuthState = 'loading' | 'welcome' | 'create' | 'import' | 'locked' | 'unlocked';

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

  useEffect(() => {
    // Best-effort, deferred: warms the secp256k1/ed25519 precomputation
    // so it isn't paid synchronously at onboarding handoff (see keys.ts's
    // own comment on why that timing matters).
    const timer = setTimeout(warmupCrypto, 0);
    // Also best-effort: sets up Particle's SDK so the first real tap of
    // "Continue with Google" isn't also paying init's cost — a missing/
    // invalid native config here is surfaced later, loudly, from
    // loginWithGoogle itself, not swallowed.
    initParticleAuth();
    hasVault().then(exists => setAuthState(exists ? 'locked' : 'welcome'));
    return () => clearTimeout(timer);
  }, []);

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
    // A Google-login session has no local vault/password to unlock
    // against — sending it to the password-prompt LockedScreen would
    // strand the user there with nothing to type. Sign them out
    // entirely instead; loginWithGoogle() on the next "Continue with
    // Google" tap resolves fast if Particle's own SDK still has a live
    // native session, same as any "silently re-authenticate" pattern.
    const wasGoogleSession = session?.authMethod === 'google';
    setSession(null);
    if (wasGoogleSession) {
      logoutParticle();
      setAuthState('welcome');
    } else {
      setAuthState('locked');
    }
  }, [session, setSession]);

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

  if (authState === 'loading') {
    return (
      <View style={[styles.loadingScreen, {backgroundColor: colors.bg}]}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
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
    return <LockedScreen onUnlock={unlock} />;
  }
  return <AutoLockContext.Provider value={{autoLockMs, setAutoLockMs: handleAutoLockChange}}>{children}</AutoLockContext.Provider>;
}

function AppInner(): React.JSX.Element {
  const {colors, mode} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('home');
  const [screen, setScreen] = useState<Screen>('tabs');
  const [selectedToken, setSelectedToken] = useState<DemoToken | undefined>(undefined);

  const showingSettings = screen === 'settings';
  const showingHistory = screen === 'history';
  const showingPushedScreen = showingSettings || showingHistory;
  const openSettings = () => setScreen('settings');
  const openHistory = () => setScreen('history');
  // Settings' own "Deposit and Withdraw" row has no dedicated screen of
  // its own — Profile already IS that real destination (the totalCash
  // row's +/- buttons), so this just takes the user there instead of
  // duplicating that modal's state in a second place.
  const goToWalletActions = () => {
    setScreen('tabs');
    setTab('profile');
  };

  function selectSearchResult(result: TokenSearchResult) {
    setSelectedToken({chainKey: result.chainKey, address: result.tokenAddress, symbol: result.symbol});
    setTab('swap');
  }

  return (
    <SafeAreaProvider>
      {/* backgroundColor is gone from RN 0.87's StatusBar types — recent
          Android versions enforce edge-to-edge display, where the status
          bar is transparent over app content rather than a colored strip
          the app paints. barStyle (icon color) is what's left to control. */}
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <AuthGate>
          <View style={styles.body}>
            {showingSettings ? (
              <SettingsScreen onBack={() => setScreen('tabs')} onOpenDepositWithdraw={goToWalletActions} />
            ) : showingHistory ? (
              <HistoryScreen onBack={() => setScreen('tabs')} />
            ) : tab === 'home' ? (
              <HomeScreen />
            ) : tab === 'search' ? (
              <SearchScreen onSelectToken={selectSearchResult} />
            ) : tab === 'swap' ? (
              <TokenTradeScreen token={selectedToken} onOpenSearch={() => setTab('search')} />
            ) : (
              <ProfileScreen onOpenSettings={openSettings} onOpenHistory={openHistory} />
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
