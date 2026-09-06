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
import {Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {
  BellIcon,
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ContrastIcon,
  FileTextIcon,
  GlobeIcon,
  HelpCircleIcon,
  LandmarkIcon,
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
import {SecurityScreen} from './SecurityScreen';
import {AppearanceScreen} from './AppearanceScreen';
import {SolanaDevnetTestScreen} from './SolanaDevnetTestScreen';

// Same real URLs as mango-mobile's own src/settings/AboutModal.tsx —
// one Mango, same channels, not a separate app's accounts.
const X_URL = 'https://x.com/Mango_protocol';
const TELEGRAM_URL = 'https://t.me/mango_protocol';

type Row = {
  key: string;
  label: string;
  Icon: IconComponent;
  value?: string;
  onPress?: () => void;
};

export function SettingsScreen({onBack, onOpenDepositWithdraw}: {onBack: () => void; onOpenDepositWithdraw: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {session} = useSession();
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
    // nothing to prove here.
    ...(session?.authMethod === 'google'
      ? [{key: 'solana-devnet-test', label: 'Solana signing test (devnet)', Icon: RepeatIcon, onPress: () => setShowSolanaDevnetTest(true)}]
      : []),
    {key: 'legal', label: 'Legal and Privacy', Icon: ScaleIcon},
    {key: 'taxes', label: 'Taxes', Icon: FileTextIcon},
    {key: 'help', label: 'Help and Support', Icon: HelpCircleIcon},
    {key: 'docs', label: 'Documentation', Icon: BookOpenIcon},
    {key: 'x', label: 'X', Icon: XIcon, onPress: () => Linking.openURL(X_URL)},
    {key: 'telegram', label: 'Telegram', Icon: TelegramIcon, onPress: () => Linking.openURL(TELEGRAM_URL)},
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

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Settings</Text>
      <ScrollView contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
        {ROWS.map((row, i) => (
          <TouchableOpacity key={row.key} style={styles.row} activeOpacity={0.6} onPress={row.onPress}>
            <View style={styles.rowIcon}>
              <row.Icon color={colors.textPrimary} />
            </View>
            <Text style={styles.rowLabel}>{row.label}</Text>
            {row.value != null && <Text style={styles.rowValue}>{row.value}</Text>}
            <ChevronRightIcon color={colors.textMuted} size={16} />
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
