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

import React, {useEffect, useMemo, useState} from 'react';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {ActivityIndicator, StatusBar, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ThemeProvider, useTheme, type Colors} from './src/theme/ThemeContext';
import {SessionProvider, useSession} from './src/wallet/SessionContext';
import {deriveAccounts, warmupCrypto} from './src/wallet/keys';
import {createVault, hasVault, loadVault, unlockVaultMnemonic} from './src/wallet/vault';
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
import type {TokenSearchResult} from './src/core/tokenSearch';

type Tab = 'home' | 'search' | 'swap' | 'profile';
type Screen = 'tabs' | 'settings';
type AuthState = 'loading' | 'welcome' | 'create' | 'import' | 'locked' | 'unlocked';

const TABS: {key: Tab; label: string; icon: TabIconName}[] = [
  {key: 'home', label: 'Home', icon: 'home'},
  {key: 'search', label: 'Search', icon: 'search'},
  {key: 'swap', label: 'Swap', icon: 'swap'},
  {key: 'profile', label: 'Profile', icon: 'profile'},
];

function AuthGate({children}: {children: React.ReactNode}): React.JSX.Element {
  const {colors} = useTheme();
  const {setSession} = useSession();
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    // Best-effort, deferred: warms the secp256k1/ed25519 precomputation
    // so it isn't paid synchronously at onboarding handoff (see keys.ts's
    // own comment on why that timing matters).
    const timer = setTimeout(warmupCrypto, 0);
    hasVault().then(exists => setAuthState(exists ? 'locked' : 'welcome'));
    return () => clearTimeout(timer);
  }, []);

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
    return <WelcomeScreen onCreate={() => setAuthState('create')} onImport={() => setAuthState('import')} />;
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
  return <>{children}</>;
}

function AppInner(): React.JSX.Element {
  const {colors, mode} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('home');
  const [screen, setScreen] = useState<Screen>('tabs');
  const [selectedToken, setSelectedToken] = useState<DemoToken | undefined>(undefined);

  const showingSettings = screen === 'settings';
  const openSettings = () => setScreen('settings');

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
              <SettingsScreen onBack={() => setScreen('tabs')} />
            ) : tab === 'home' ? (
              <HomeScreen />
            ) : tab === 'search' ? (
              <SearchScreen onSelectToken={selectSearchResult} />
            ) : tab === 'swap' ? (
              <TokenTradeScreen token={selectedToken} onOpenSearch={() => setTab('search')} onOpenSettings={openSettings} />
            ) : (
              <ProfileScreen onOpenSettings={openSettings} />
            )}
          </View>

          {!showingSettings && (
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
