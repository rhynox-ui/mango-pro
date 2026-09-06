/**
 * Mango Pro — mobile app entry point.
 *
 * A screen-switch state machine, same pattern as mango-mobile's own
 * App.tsx, rather than a navigation library. Five root tabs (Home,
 * Search, Swap, Community, Profile); Settings is a pushed screen reached
 * from Profile's own gear icon, not a tab — matching the reference this
 * nav was built against. No shared app-level header bar: each screen
 * (Home's logo+balance row, Profile's banner+icons, Settings' own back
 * chevron, the trade screen's own chain pill) owns its own top area
 * instead of a redundant generic title bar sitting above all of them.
 *
 * @format
 */

import React, {useMemo, useState} from 'react';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ThemeProvider, useTheme, type Colors} from './src/theme/ThemeContext';
import {TabIcon, type TabIconName} from './src/navigation/TabIcon';
import {HomeScreen} from './src/screens/HomeScreen';
import {SearchScreen} from './src/screens/SearchScreen';
import {PlaceholderScreen} from './src/screens/PlaceholderScreen';
import {TokenTradeScreen} from './src/screens/TokenTradeScreen';
import {ProfileScreen} from './src/screens/ProfileScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';

type Tab = 'home' | 'search' | 'swap' | 'community' | 'profile';
type Screen = 'tabs' | 'settings';

const TABS: {key: Tab; label: string; icon: TabIconName}[] = [
  {key: 'home', label: 'Home', icon: 'home'},
  {key: 'search', label: 'Search', icon: 'search'},
  {key: 'swap', label: 'Swap', icon: 'swap'},
  {key: 'community', label: 'Community', icon: 'community'},
  {key: 'profile', label: 'Profile', icon: 'profile'},
];

function AppInner(): React.JSX.Element {
  const {colors, mode} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('home');
  const [screen, setScreen] = useState<Screen>('tabs');

  const showingSettings = screen === 'settings';
  const openSettings = () => setScreen('settings');

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={colors.bg} />
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <View style={styles.body}>
          {showingSettings ? (
            <SettingsScreen onBack={() => setScreen('tabs')} />
          ) : tab === 'home' ? (
            <HomeScreen />
          ) : tab === 'search' ? (
            <SearchScreen />
          ) : tab === 'swap' ? (
            <TokenTradeScreen onOpenSearch={() => setTab('search')} onOpenSettings={openSettings} />
          ) : tab === 'community' ? (
            <PlaceholderScreen title="Community" note="Following, leaderboards, and copy-trade discovery land in a later pass." />
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
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

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
      <AppInner />
    </ThemeProvider>
  );
}
