// src/screens/SettingsScreen.tsx
//
// Reached from Profile's own gear icon (pushed screen with a back
// chevron), not a bottom tab — matching the reference. Most rows are a
// real navigation target once their own screen exists; for now each of
// those is an honest no-op placeholder rather than a dead-looking
// static list, per this app's "real shell, not a mock" discipline. The
// two social rows are the exception — real links exist today (Mango's
// actual channels are X and Telegram, not Discord), so they open for
// real rather than sitting as a placeholder for no reason.

import {useState} from 'react';
import {Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {
  AlertCircleIcon,
  BellIcon,
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ContrastIcon,
  FileTextIcon,
  GlobeIcon,
  HelpCircleIcon,
  LandmarkIcon,
  LogOutIcon,
  RepeatIcon,
  ScaleIcon,
  ShieldCheckIcon,
  TelegramIcon,
  UserIcon,
  XIcon,
  type IconComponent,
} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {useSession} from '../wallet/SessionContext';
import {useAuthActions} from '../settings/AuthActionsContext';
import {SecurityScreen} from './SecurityScreen';
import {AppearanceScreen} from './AppearanceScreen';
import {SolanaDevnetTestScreen} from './SolanaDevnetTestScreen';

// Same real URLs as mango-mobile's own src/settings/AboutModal.tsx —
// one Mango, same channels, not a separate app's accounts.
const X_URL = 'https://x.com/Mango_protocol';
const TELEGRAM_URL = 'https://t.me/mango_protocol';
const DOCS_URL = 'https://mangoprotocol.site';
const SUPPORT_MAIL_URL = 'mailto:mango@mangoprotocol.site';

type Row = {
  key: string;
  label: string;
  Icon: IconComponent;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
};

export function SettingsScreen({onBack, onOpenDepositWithdraw}: {onBack: () => void; onOpenDepositWithdraw: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {session} = useSession();
  const {logout} = useAuthActions();
  const [showSecurity, setShowSecurity] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showSolanaDevnetTest, setShowSolanaDevnetTest] = useState(false);

  // Security and Appearance push to their own real screen; Deposit and
  // Withdraw has no dedicated screen of its own to push to — Profile's
  // own totalCash row already IS that real feature, so this row just
  // navigates there instead of duplicating its modal state a second
  // place. Every other row stays the honest no-op placeholder this
  // file's own header already explains.
  const ROWS: Row[] = [
    {key: 'profile', label: 'Profile and Account', Icon: UserIcon},
    {key: 'appearance', label: 'Appearance and Haptics', Icon: ContrastIcon, onPress: () => setShowAppearance(true)},
    {key: 'language', label: 'Language', Icon: GlobeIcon, value: 'System'},
    {key: 'notifications', label: 'Notifications', Icon: BellIcon},
    {key: 'security', label: 'Security', Icon: ShieldCheckIcon, onPress: () => setShowSecurity(true)},
    {key: 'deposit', label: 'Deposit and Withdraw', Icon: LandmarkIcon, onPress: onOpenDepositWithdraw},
    // Diagnostic only, only meaningful for a Google-login session (see
    // this row's own destination screen for why) — a local seed-phrase
    // session already signs Solana transactions directly and has
    // nothing to prove here. __DEV__-gated on top of that: this is real
    // developer tooling for an unverified path (particleSigning.ts's own
    // header — Google-session Solana signing shipped ahead of a
    // real-device proof), not something an end user on a release build
    // should see in their own Settings. Kept, not deleted, so it's still
    // reachable from a debug build if that verification is ever done.
    ...(__DEV__ && session?.authMethod === 'google'
      ? [{key: 'solana-devnet-test', label: 'Solana signing test (devnet)', Icon: RepeatIcon, onPress: () => setShowSolanaDevnetTest(true)}]
      : []),
    {key: 'legal', label: 'Legal and Privacy', Icon: ScaleIcon},
    {key: 'taxes', label: 'Taxes', Icon: FileTextIcon},
    {key: 'help', label: 'Help and Support', Icon: HelpCircleIcon, onPress: () => Linking.openURL(SUPPORT_MAIL_URL)},
    {key: 'docs', label: 'Documentation', Icon: BookOpenIcon, onPress: () => Linking.openURL(DOCS_URL)},
    {key: 'x', label: 'X', Icon: XIcon, onPress: () => Linking.openURL(X_URL)},
    {key: 'telegram', label: 'Telegram', Icon: TelegramIcon, onPress: () => Linking.openURL(TELEGRAM_URL)},
    {
      key: 'log-out',
      label: 'Log Out',
      Icon: LogOutIcon,
      danger: true,
      onPress: () =>
        Alert.alert('Log Out', session?.authMethod === 'google' ? 'Sign out of your Google account? You can sign back in any time.' : 'Lock this wallet? You can unlock it again with your password.', [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Log Out', style: 'destructive', onPress: logout},
        ]),
    },
    {
      key: 'delete-account',
      label: 'Delete Account',
      Icon: AlertCircleIcon,
      danger: true,
      onPress: () =>
        Alert.alert(
          'Delete Account',
          "Mango Pro is non-custodial — there's no server-side account to delete. The real equivalent is wiping this wallet from your device, which isn't built as its own action yet (it needs a proper \"have you backed up your recovery phrase\" confirmation first, since it can't be undone). For now, uninstalling the app removes everything it stores locally.",
        ),
    },
  ];

  if (showSecurity) {
    return <SecurityScreen onBack={() => setShowSecurity(false)} />;
  }
  if (showAppearance) {
    return <AppearanceScreen onBack={() => setShowAppearance(false)} />;
  }
  if (showSolanaDevnetTest) {
    return <SolanaDevnetTestScreen onBack={() => setShowSolanaDevnetTest(false)} />;
  }

  // Rows with no real destination yet still need to respond to a tap —
  // silently doing nothing reads as broken, not as "not built yet". Same
  // honest-disclosure rule this app already holds itself to elsewhere
  // (App.tsx's own header: a destination going nowhere isn't honest;
  // this is the equivalent for a settings row instead of a nav tab).
  function comingSoon(label: string) {
    Alert.alert('Coming soon', `${label} isn't built yet.`);
  }

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Settings</Text>
      <ScrollView contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
        {ROWS.map((row, i) => (
          <TouchableOpacity key={row.key} style={styles.row} activeOpacity={0.6} onPress={row.onPress ?? (() => comingSoon(row.label))}>
            <View style={styles.rowIcon}>
              <row.Icon color={row.danger ? colors.danger : colors.textPrimary} />
            </View>
            <Text style={[styles.rowLabel, row.danger && {color: colors.danger}]}>{row.label}</Text>
            {row.value != null && <Text style={styles.rowValue}>{row.value}</Text>}
            {!row.danger && <ChevronRightIcon color={colors.textMuted} size={16} />}
            {i < ROWS.length - 1 && <View style={styles.divider} />}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16},
    backButton: {paddingTop: 8, paddingBottom: 4, alignSelf: 'flex-start'},
    title: {color: colors.textPrimary, fontSize: 34, fontWeight: '800', marginTop: 6, marginBottom: 8},
    rows: {paddingBottom: 32},
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 16,
      position: 'relative',
    },
    rowIcon: {width: 24, alignItems: 'center'},
    rowLabel: {flex: 1, color: colors.textPrimary, fontSize: 16.5, fontWeight: '500'},
    rowValue: {color: colors.textMuted, fontSize: 14, marginRight: 4},
    divider: {position: 'absolute', bottom: 0, left: 38, right: 0, height: 1, backgroundColor: colors.divider},
  });
}
