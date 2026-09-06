/**
 * Mango Pro — mobile app entry point.
 *
 * A screen-switch state machine, same pattern as mango-mobile's own
 * App.tsx, rather than a navigation library — this app has four flat
 * tabs and one drill-in screen (the token trade screen), not nested
 * stacks deep enough yet to need one.
 *
 * @format
 */

import React, {useMemo, useState} from 'react';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ThemeProvider, useTheme, type Colors} from './src/theme/ThemeContext';
import {TabIcon, type TabIconName} from './src/navigation/TabIcon';
import {SearchScreen} from './src/screens/SearchScreen';
import {PlaceholderScreen} from './src/screens/PlaceholderScreen';
import {TokenTradeScreen} from './src/screens/TokenTradeScreen';

type Tab = 'search' | 'portfolio' | 'activity' | 'settings';
type Screen = {name: 'tabs'} | {name: 'trade'};

const TABS: {key: Tab; label: string; icon: TabIconName}[] = [
  {key: 'search', label: 'Search', icon: 'search'},
  {key: 'portfolio', label: 'Portfolio', icon: 'wallet'},
  {key: 'activity', label: 'Activity', icon: 'activity'},
  {key: 'settings', label: 'Settings', icon: 'settings'},
];

function AppInner(): React.JSX.Element {
  const {colors, mode} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('search');
  const [screen, setScreen] = useState<Screen>({name: 'tabs'});

  const showingTrade = screen.name === 'trade';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={colors.bg} />
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          {showingTrade ? (
            <TouchableOpacity onPress={() => setScreen({name: 'tabs'})} hitSlop={8}>
              <Text style={styles.backLabel}>‹ Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
          <Text style={styles.headerTitle}>{showingTrade ? 'PEPE / Ethereum' : 'Mango Pro'}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.body}>
          {showingTrade ? (
            <TokenTradeScreen onOpenSearch={() => setScreen({name: 'tabs'})} />
          ) : tab === 'search' ? (
            <SearchScreen onOpenSample={() => setScreen({name: 'trade'})} />
          ) : tab === 'portfolio' ? (
            <PlaceholderScreen title="Portfolio" note="One balance across every chain — build plan §37/Phase 3." />
          ) : tab === 'activity' ? (
            <PlaceholderScreen title="Activity" note="Transaction tracking lands with the Phase 1 core loop (build plan §7)." />
          ) : (
            <PlaceholderScreen
              title="Settings"
              note="Wallet creation, Google sign-in, and theme live here once Phase 0's account-abstraction spike picks a provider."
            />
          )}
        </View>

        {!showingTrade && (
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
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.panelBorder,
    },
    headerSpacer: {width: 48},
    headerTitle: {fontSize: 17, fontWeight: '600', color: colors.textPrimary},
    backLabel: {fontSize: 15, fontWeight: '600', color: colors.textPrimary, width: 48},
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
