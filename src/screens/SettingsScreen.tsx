// src/screens/SettingsScreen.tsx
//
// Reached from Profile's own gear icon (pushed screen with a back
// chevron), not a bottom tab — matching the reference. Every row is a
// real navigation target once its own screen exists; for now each is an
// honest no-op placeholder rather than a dead-looking static list, per
// this app's "real shell, not a mock" discipline.

import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {
  BellIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ContrastIcon,
  DiscordIcon,
  FileTextIcon,
  GlobeIcon,
  HelpCircleIcon,
  LandmarkIcon,
  ScaleIcon,
  ShieldCheckIcon,
  UserIcon,
  type IconComponent,
} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';

type Row = {
  key: string;
  label: string;
  Icon: IconComponent;
  value?: string;
};

const ROWS: Row[] = [
  {key: 'profile', label: 'Profile and Account', Icon: UserIcon},
  {key: 'appearance', label: 'Appearance and Haptics', Icon: ContrastIcon},
  {key: 'language', label: 'Language', Icon: GlobeIcon, value: 'System'},
  {key: 'notifications', label: 'Notifications', Icon: BellIcon},
  {key: 'security', label: 'Security', Icon: ShieldCheckIcon},
  {key: 'deposit', label: 'Deposit and Withdraw', Icon: LandmarkIcon},
  {key: 'legal', label: 'Legal and Privacy', Icon: ScaleIcon},
  {key: 'taxes', label: 'Taxes', Icon: FileTextIcon},
  {key: 'help', label: 'Help and Support', Icon: HelpCircleIcon},
  {key: 'discord', label: 'Discord', Icon: DiscordIcon},
];

export function SettingsScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Settings</Text>
      <ScrollView contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
        {ROWS.map((row, i) => (
          <TouchableOpacity key={row.key} style={styles.row} activeOpacity={0.6}>
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
