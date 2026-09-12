// src/screens/DocumentationScreen.tsx
//
// Settings' own Documentation row used to open https://mangoprotocol.site
// — the bare marketing homepage, not documentation, and not specific to
// this app at all (mango-pro, mango-mobile, and the site itself all
// pointed there). Real in-app docs instead: every section below
// describes something this build actually does, cross-checked against
// the real module backing it (named in each section's own comment) so
// this can't silently drift into describing a feature that got removed
// or renamed later without this file being touched too.

import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ChevronLeftIcon} from '../components/icons';
import {CHAIN_LABEL, type ChainKey} from '../core/chainData';
import {USDC_SUPPORTED_CHAINS} from '../core/usdcBalances';
import {DEV_FEE_PCT} from '../core/fees';
import {useTheme, type Colors} from '../theme/ThemeContext';

type Section = {title: string; body: string};

// Every chain this app trades on but has no verified USDC contract for
// (Robinhood Chain's own real stablecoin is USDG, not USDC; a few
// others only have USDT0) — derived the same way USDC_SUPPORTED_CHAINS
// itself is, so this list can't silently go stale if that changes.
const ALL_CHAIN_KEYS = Object.keys(CHAIN_LABEL) as ChainKey[];
const NON_USDC_CHAINS = ALL_CHAIN_KEYS.filter(c => !USDC_SUPPORTED_CHAINS.includes(c));

const SECTIONS: Section[] = [
  {
    title: 'What Mango Pro is',
    body:
      'Most wallets make you pick a chain first and a token second. Mango Pro flips that: search a token by name or ticker, and the app works out which chain it lives on, how to pay for it, and how to route the trade — you never have to think about chains, gas, or bridging as separate steps. It’s non-custodial the whole way through: your keys (or, for a Google login, your share of them) never leave your device and Particle’s MPC network, there’s no Mango account or password to lose, and every trade is a transaction your own device signs and a real routing service (Relay) fills — never something a Mango server executes on your behalf.',
  },
  {
    title: 'Your wallet',
    body:
      'You get two ways in. Create or import a recovery phrase and Mango Pro derives your keys on this device — Mango never sees them, and the seed is encrypted with the password you set before it ever touches disk. Or continue with Google: your key is split between this device and Particle’s MPC network, so no single party (including Mango) ever holds the whole thing. Either way, the addresses shown in Profile are real — signing and broadcasting happen directly from your device, with no Mango server sitting in between.',
  },
  {
    title: 'Biometric unlock and app lock',
    body:
      'A seed-phrase wallet can enable biometric unlock in Security — your password is stored behind your device’s own fingerprint/face check (Android Keystore / iOS Keychain), so the raw password never has to be retyped. A Google-session wallet has no local password to protect that way, so Security instead offers app lock: turn it on and reopening the app after it’s been backgrounded requires your biometrics before the screen unlocks, even though the underlying Google session stays live. Auto-lock (also in Security) controls how long the app can sit in the background before either of these kicks in at all.',
  },
  {
    title: 'Finding tokens',
    body:
      'Home’s Tokens tab shows Trending (DexScreener’s real paid-boost list merged with GeckoTerminal’s real per-chain trending pools, not a guess), Graduated and Bonding (pump.fun’s own bonding-curve state, Solana-only), each hydrated with a live price, 24h change, market cap, volume, transaction count, and pair age. Most held has no honest data behind it yet — there’s no bulk on-chain holder-count API and no aggregate Mango user data to rank by — so it says exactly that instead of faking a number. The filter icon sorts by any of those real fields and narrows by market-cap range; the chain chips that appear alongside it narrow the list to one network at a time, whichever chains that list actually has tokens on. Tap a token’s Holders panel on its chart to see a real GoPlus security check — top holders, LP lock status, and honeypot/tax flags — before you trade it. Search looks up any token by name or ticker across every supported chain, ranked by real on-chain liquidity. Tap the star on any row to add it to your Watchlist, a second Home tab for the tokens you’re tracking, saved on this device.',
  },
  {
    title: 'Buying and selling',
    body:
      'Every quote on the trade screen is a real, live quote from Relay, not an estimate — slippage (Trade Settings, the gear icon there) is sent straight through to it. Buying isn’t limited to the token’s own chain: tap “Pay from” to fund a buy from a different chain’s native asset or USDC, and Relay routes the bridge and the swap together in one confirmation. Selling works the other way too — tap “Receive as” to take the proceeds as USDC instead of the chain’s native asset, wherever that chain has real USDC. If Relay itself has no route for a thin or very new token, Mango Pro automatically checks a series of direct on-chain DEXs and aggregators on EVM chains, or pump.fun’s bonding curve and PumpSwap on Solana, before giving up. A price-impact warning appears when a trade would move the pool more than 3%. Every trade — Relay’s or a fallback’s — is checked by this app’s own transaction-intent firewall before anything is signed: it verifies the chain, recipient, and approval amount actually match what you quoted, so a manipulated response gets caught before it can be signed rather than after.',
  },
  {
    title: 'Deposits and withdrawals',
    body:
      `Profile’s Total cash shows your real USDC balance across every chain that has a verified USDC contract (${USDC_SUPPORTED_CHAINS.map((c: ChainKey) => CHAIN_LABEL[c]).join(', ')}). Deposit shows the real address for whichever chain you pick — one EVM address covers every EVM chain in that list, Solana has its own separate address. Withdraw sends USDC directly from your device to any address you enter, broadcast straight to the chain — there is no Mango server in that path, and sends can’t be reversed once confirmed. ${NON_USDC_CHAINS.length > 0 ? `${NON_USDC_CHAINS.map(c => CHAIN_LABEL[c]).join(', ')} don’t have a verified USDC contract yet, so USDC deposit/withdraw and “pay or receive in USDC” aren’t available there — trading on those chains still works using their own native asset.` : ''}`,
  },
  {
    title: 'Portfolio',
    body:
      'The chart on Profile plots your real total USDC balance over time — 24h, 7d, 30d, or All — with the $ and % change colored green or red. It only ever shows real, recorded history: a snapshot is saved locally on this device each time your balance is checked, starting from whenever you first opened this version of the app, never a reconstructed or estimated past. A range with fewer than two real data points says so honestly instead of drawing a chart from data that doesn’t exist yet.',
  },
  {
    title: 'Trade history and taxes',
    body:
      'History (the clock icon on Profile) lists every trade this device has executed, newest first, with a link to the real block explorer for any trade with a hash. Settings’ Taxes row exports that same history as a CSV — date, chain, amounts, and transaction hash for every trade. It’s raw data for your own tax software, not a finished tax report: this app doesn’t track cost basis or compute gains, so it never fabricates numbers it can’t honestly back up.',
  },
  {
    title: 'Referral and points',
    body:
      'The share icon on Profile opens Referral & points — the same points system the Mango site and mobile app already run, so a wallet you use across any of them keeps one shared balance and history. Points come from a daily check-in (needs a seed-phrase wallet’s signature, so it isn’t available for a Google session yet) and from friends who join with your invite link. Claiming a memorable handle is optional, one-time, and one per wallet — it just replaces the raw address in your invite link, it doesn’t change how points are earned.',
  },
  {
    title: 'Fees',
    body:
      `Mango charges a flat ${(DEV_FEE_PCT * 100).toFixed(2).replace(/\.?0+$/, '')}% fee on trades, shown on the trade screen before you confirm — never hidden in the quoted price. Network fees are Relay’s own, shown the same way.`,
  },
  {
    title: 'Non-custodial, by design',
    body:
      'Mango Pro has no backend account system — no username, no password reset, no server holding your data. Everything on Profile and Settings lives on this device only. That’s also why some rows (Language, for one) stay an honest “not built yet” rather than a fake toggle: a feature only shows up here once it’s real.',
  },
];

export function DocumentationScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Documentation</Text>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {SECTIONS.map(section => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
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
    content: {paddingBottom: 40, gap: 24},
    section: {gap: 6},
    sectionTitle: {color: colors.textPrimary, fontSize: 15.5, fontWeight: '800'},
    sectionBody: {color: colors.textSecondary, fontSize: 13.5, lineHeight: 20},
  });
}
