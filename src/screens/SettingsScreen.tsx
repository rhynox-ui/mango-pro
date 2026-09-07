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
import {Alert, Linking, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
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
import {filterTxHistoryForAccount, getTxHistory} from '../wallet/txHistory';
import {SecurityScreen} from './SecurityScreen';
import {AppearanceScreen} from './AppearanceScreen';
import {SolanaDevnetTestScreen} from './SolanaDevnetTestScreen';
import {DocumentationScreen} from './DocumentationScreen';

// Same real URLs as mango-mobile's own src/settings/AboutModal.tsx —
// one Mango, same channels, not a separate app's accounts.
const X_URL = 'https://x.com/Mango_protocol';
const TELEGRAM_URL = 'https://t.me/mango_protocol';
const SUPPORT_MAIL_URL = 'mailto:mango@mangoprotocol.site';
// The real, hosted privacy policy mango-mobile's own Play Console listing
// already points to (src/settings/AboutModal.tsx) — genuine shared legal
// content across the product family, unlike the Documentation row's old
// bare marketing-homepage link (see DocumentationScreen.tsx's own header
// for why that one became real in-app content instead).
const PRIVACY_POLICY_URL = 'https://mangoprotocol.site/app-privacy.html';

/** Real CSV export of this account's own trade history — every column is a value txHistory.ts already recorded, nothing computed or estimated (no gain/loss, no cost-basis) since this app tracks neither; a user's real tax software can derive those from real amounts and timestamps, this just gets that data out. */
function tradeHistoryCsv(entries: ReturnType<typeof getTxHistory>): string {
  const header = 'Date,Type,Chain,Status,Pay amount,Pay asset,Received amount,Received asset,Transaction hash';
  const rows = entries.map(e => {
    const date = new Date(e.timestamp).toISOString();
    const type = e.isBuySide ? 'Buy' : 'Sell';
    const received = e.status === 'success' ? (e.receivedAmountFormatted ?? '') : '';
    const hash = e.hashes[0] ?? '';
    return [date, type, e.chainLabel, e.status, e.payAmount, e.paySymbol, received, e.receiveSymbol, hash].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  return [header, ...rows].join('\n');
}

type Row = {
  key: string;
  label: string;
  Icon: IconComponent;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
};

export function SettingsScreen({
  onBack,
  onOpenDepositWithdraw,
  onOpenProfile,
}: {
  onBack: () => void;
  onOpenDepositWithdraw: () => void;
  onOpenProfile: () => void;
}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {session} = useSession();
  const {logout} = useAuthActions();
  const [showSecurity, setShowSecurity] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [showSolanaDevnetTest, setShowSolanaDevnetTest] = useState(false);

  async function handleExportTaxes() {
    const scoped = session ? filterTxHistoryForAccount(getTxHistory(), {evmAddress: session.evm.address, solanaAddress: session.solana.address}) : getTxHistory();
    if (scoped.length === 0) {
      Alert.alert('Nothing to export yet', 'You have no trades in this wallet\'s history yet — export becomes available after your first trade.');
      return;
    }
    try {
      await Share.share({message: tradeHistoryCsv(scoped), title: 'Mango Pro trade history.csv'});
    } catch {
      // Share sheet cancellation/failure — nothing to recover from here,
      // same "best-effort, no forced retry" treatment this app already
      // gives other share/open actions.
    }
  }

  // Security, Appearance, and Documentation each push to their own real
  // screen; Deposit and Withdraw / Profile and Account have no dedicated
  // screen of their own — Profile already IS that real feature, so those
  // rows just navigate there instead of duplicating its state a second
  // place. Notifications opens the OS's own per-app settings (this app
  // sends no push notifications of its own to have an in-app preference
  // for). Legal and Privacy opens the same real, hosted policy page
  // mango-mobile's own Play Console listing already points to. Taxes
  // exports this account's own real trade history as CSV. Language stays
  // the one honest no-op placeholder left — see its own row comment for
  // why a picker there would be fake choice, not a built feature.
  const ROWS: Row[] = [
    {key: 'profile', label: 'Profile and Account', Icon: UserIcon, onPress: onOpenProfile},
    {key: 'appearance', label: 'Appearance and Haptics', Icon: ContrastIcon, onPress: () => setShowAppearance(true)},
    // Real "System" value: this app has no translated strings for any
    // language yet, only English, so a language PICKER here would be
    // fake choice — nothing behind it would actually change. Left as the
    // honest no-op placeholder (this file's own header) rather than
    // faked, unlike every other row fixed in this pass, which each had a
    // genuine, buildable-today destination.
    {key: 'language', label: 'Language', Icon: GlobeIcon, value: 'System'},
    // This app sends no push notifications of its own yet — there is no
    // in-app preference to toggle. The one real, honest destination is
    // the OS's own per-app notification settings, same as what iOS/
    // Android themselves show if you long-press this app's icon.
    {key: 'notifications', label: 'Notifications', Icon: BellIcon, onPress: () => Linking.openSettings()},
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
    {key: 'legal', label: 'Legal and Privacy', Icon: ScaleIcon, onPress: () => Linking.openURL(PRIVACY_POLICY_URL)},
    // Real export of this account's own trade history as CSV — no
    // fabricated cost-basis/gain-loss math (this app tracks neither), so
    // it's honest about being raw data a real tax tool can work from,
    // not a finished tax report.
    {key: 'taxes', label: 'Taxes', Icon: FileTextIcon, onPress: handleExportTaxes},
    {key: 'help', label: 'Help and Support', Icon: HelpCircleIcon, onPress: () => Linking.openURL(SUPPORT_MAIL_URL)},
    {key: 'docs', label: 'Documentation', Icon: BookOpenIcon, onPress: () => setShowDocumentation(true)},
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
  if (showDocumentation) {
    return <DocumentationScreen onBack={() => setShowDocumentation(false)} />;
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
