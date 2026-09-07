// src/screens/SecurityScreen.tsx
//
// The Security row's real destination — was a no-op placeholder before
// this (see SettingsScreen.tsx's own header on why an unbuilt
// destination there is an honest dead end, not a fabrication). Real
// preferences live here: auto-lock (App.tsx's AuthGate runs the actual
// lock-on-background timer; this screen only reads/writes that setting
// via AutoLockContext, it doesn't duplicate the timer), biometric
// unlock for seed-phrase sessions (same real, hardware-backed
// react-native-keychain storage mango-mobile's own Security screen
// uses — see biometricAuth.ts), and biometric APP LOCK for Google
// sessions (appLockAuth.ts — a different mechanism, since a Google
// session has no local password/vault for biometricAuth.ts's own gate
// to protect at all; see that file's own header).

import {useState} from 'react';
import {ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View} from 'react-native';
import {ChevronLeftIcon} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {useSession} from '../wallet/SessionContext';
import {AUTO_LOCK_OPTIONS} from '../settings/autoLockPrefs';
import {useAutoLock} from '../settings/AutoLockContext';
import {useBiometric} from '../settings/BiometricContext';
import {disableBiometricUnlock} from '../wallet/biometricAuth';
import {enableAppLock, disableAppLock} from '../wallet/appLockAuth';
import {EnableBiometricModal} from '../wallet/EnableBiometricModal';

export function SecurityScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {session} = useSession();
  const {autoLockMs, setAutoLockMs} = useAutoLock();
  const {biometricAvailable, biometricEnabled, biometryLabel, setBiometricEnabled, appLockEnabled, setAppLockEnabled} = useBiometric();
  const [showEnableBiometric, setShowEnableBiometric] = useState(false);
  const [appLockBusy, setAppLockBusy] = useState(false);
  const isSeedSession = session?.authMethod !== 'google';

  async function handleBiometricToggle(next: boolean) {
    if (next) {
      setShowEnableBiometric(true);
    } else {
      await disableBiometricUnlock();
      setBiometricEnabled(false);
    }
  }

  // No password to verify here (unlike handleBiometricToggle above) —
  // enableAppLock()'s own OS prompt IS the confirmation, per
  // appLockAuth.ts's own header. A cancelled/failed prompt just leaves
  // the switch off, same "toggle reflects reality, not intent" contract
  // every other real switch in this screen already holds to.
  async function handleAppLockToggle(next: boolean) {
    setAppLockBusy(true);
    if (next) {
      const ok = await enableAppLock();
      setAppLockEnabled(ok);
    } else {
      await disableAppLock();
      setAppLockEnabled(false);
    }
    setAppLockBusy(false);
  }

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Security</Text>
      {isSeedSession ? (
        <>
          <Text style={styles.sectionLabel}>Biometric unlock</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchLabelWrap}>
              <Text style={styles.rowLabel}>{biometricAvailable ? `Unlock with ${biometryLabel}` : 'Biometric unlock'}</Text>
              {!biometricAvailable && <Text style={styles.sectionHint}>Not supported on this device</Text>}
            </View>
            <Switch
              value={biometricEnabled}
              onValueChange={handleBiometricToggle}
              disabled={!biometricAvailable}
              trackColor={{false: colors.panelBorder, true: colors.navActive}}
              thumbColor={colors.ctaText}
            />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.sectionLabel}>App lock</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchLabelWrap}>
              <Text style={styles.rowLabel}>{biometricAvailable ? `Require ${biometryLabel} to reopen` : 'App lock'}</Text>
              {!biometricAvailable && <Text style={styles.sectionHint}>Not supported on this device</Text>}
              {biometricAvailable && <Text style={styles.sectionHint}>Your Google sign-in stays active — this just gates reopening the app.</Text>}
            </View>
            <Switch
              value={appLockEnabled}
              onValueChange={handleAppLockToggle}
              disabled={!biometricAvailable || appLockBusy}
              trackColor={{false: colors.panelBorder, true: colors.navActive}}
              thumbColor={colors.ctaText}
            />
          </View>
        </>
      )}
      <Text style={styles.sectionLabel}>Auto-lock</Text>
      <Text style={styles.sectionHint}>Lock the wallet after this much time in the background.</Text>
      <ScrollView contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
        {AUTO_LOCK_OPTIONS.map((opt, i) => {
          const selected = opt.ms === autoLockMs;
          return (
            <TouchableOpacity key={opt.label} style={styles.row} activeOpacity={0.6} onPress={() => setAutoLockMs(opt.ms)}>
              <Text style={styles.rowLabel}>{opt.label}</Text>
              {selected && <Text style={styles.rowCheck}>✓</Text>}
              {i < AUTO_LOCK_OPTIONS.length - 1 && <View style={styles.divider} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <EnableBiometricModal
        visible={showEnableBiometric}
        biometryLabel={biometryLabel}
        onClose={() => setShowEnableBiometric(false)}
        onEnabled={() => {
          setShowEnableBiometric(false);
          setBiometricEnabled(true);
        }}
      />
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16},
    backButton: {paddingTop: 8, paddingBottom: 4, alignSelf: 'flex-start'},
    title: {color: colors.textPrimary, fontSize: 34, fontWeight: '800', marginTop: 6, marginBottom: 8},
    sectionLabel: {color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10, marginBottom: 4},
    sectionHint: {color: colors.textMuted, fontSize: 12.5, marginBottom: 10},
    switchRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, marginBottom: 6},
    switchLabelWrap: {flex: 1, marginRight: 12},
    rows: {paddingBottom: 32},
    row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, position: 'relative'},
    rowLabel: {flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '500'},
    rowCheck: {color: colors.navActive, fontSize: 16, fontWeight: '800'},
    divider: {position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, backgroundColor: colors.divider},
  });
}
