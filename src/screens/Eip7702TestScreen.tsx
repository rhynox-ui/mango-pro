// src/screens/Eip7702TestScreen.tsx
//
// A real, isolated Base Sepolia testnet test for the EIP-7702 smart-
// account path (smartAccount.ts) — built specifically to prove a real
// Pimlico-sponsored UserOperation actually lands BEFORE this is trusted
// with real trades in executeRelayQuote.ts. Same discipline
// SolanaDevnetTestScreen.tsx already holds itself to for Particle's
// Solana signing path.
//
// The test: the real logged-in wallet's own EOA signs a 7702
// delegation authorization SCOPED TO BASE SEPOLIA ONLY (the chain id
// baked into the authorization comes from the `baseSepolia` client
// smartAccount.ts's getSponsoredSmartAccountClient is given — never a
// chain-agnostic/"any chain" authorization), then sends a zero-value
// self-call as a sponsored UserOperation. If Pimlico's paymaster
// declines or the bundler rejects it, that's a real, informative
// failure to see now — not a guess.
//
// Only reachable from Settings, mirroring SolanaDevnetTestScreen.tsx's
// own placement and gating.

import {useState} from 'react';
import {ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {baseSepolia} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {ChevronLeftIcon} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {useSession} from '../wallet/SessionContext';
import {getSponsoredSmartAccountClient, isSmartAccountSponsorshipConfigured} from '../wallet/smartAccount';

type TestState = {status: 'idle' | 'running' | 'success' | 'error'; hash?: string; error?: string};

export function Eip7702TestScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {session} = useSession();
  const [state, setState] = useState<TestState>({status: 'idle'});

  async function runTest() {
    if (!session || session.evm.privateKey.length === 0) return;
    setState({status: 'running'});
    try {
      const owner = privateKeyToAccount(session.evm.privateKey as `0x${string}`);
      const client = await getSponsoredSmartAccountClient({chain: baseSepolia, owner});
      const hash = await client.sendTransaction({to: client.account.address, value: 0n});
      setState({status: 'success', hash});
    } catch (err) {
      setState({status: 'error', error: err instanceof Error ? err.message : String(err)});
    }
  }

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Gasless trading test</Text>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>
          Delegates this wallet's real address to a smart-account implementation via EIP-7702, scoped to Base Sepolia only,
          then sends a zero-value sponsored transaction to itself through Pimlico — proves the gasless-trading path works
          before it's trusted with real trades. Testnet only; never touches mainnet funds.
        </Text>

        {!isSmartAccountSponsorshipConfigured() ? (
          <Text style={styles.hint}>Not configured — missing Pimlico API key.</Text>
        ) : !session || session.evm.privateKey.length === 0 ? (
          <Text style={styles.hint}>Unlock a seed-phrase wallet to run this test — Google/Particle sessions aren't wired to this yet.</Text>
        ) : (
          <TouchableOpacity
            onPress={runTest}
            activeOpacity={0.85}
            disabled={state.status === 'running'}
            style={[styles.button, state.status === 'running' && styles.buttonDisabled]}>
            {state.status === 'running' ? <ActivityIndicator color={colors.ctaText} /> : <Text style={styles.buttonText}>Run testnet test</Text>}
          </TouchableOpacity>
        )}

        {state.status === 'success' && state.hash && (
          <View style={styles.resultBox}>
            <Text style={styles.resultSuccess}>Sponsored transaction confirmed.</Text>
            <TouchableOpacity onPress={() => Linking.openURL(`https://sepolia.basescan.org/tx/${state.hash}`)}>
              <Text style={styles.resultLink}>View on BaseScan (Sepolia) →</Text>
            </TouchableOpacity>
          </View>
        )}
        {state.status === 'error' && (
          <View style={styles.resultBox}>
            <Text style={styles.resultError}>{state.error}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16},
    backButton: {paddingTop: 8, paddingBottom: 4, alignSelf: 'flex-start'},
    title: {color: colors.textPrimary, fontSize: 28, fontWeight: '800', marginTop: 6, marginBottom: 12},
    content: {paddingBottom: 32, gap: 16},
    hint: {color: colors.textMuted, fontSize: 13.5, lineHeight: 19},
    button: {height: 50, borderRadius: 25, backgroundColor: colors.ctaBg, alignItems: 'center', justifyContent: 'center'},
    buttonDisabled: {opacity: 0.6},
    buttonText: {color: colors.ctaText, fontSize: 15, fontWeight: '700'},
    resultBox: {padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.panelBorder, gap: 8},
    resultSuccess: {color: colors.gain, fontSize: 14, fontWeight: '600'},
    resultError: {color: colors.danger, fontSize: 13.5, lineHeight: 19},
    resultLink: {color: colors.navActive, fontSize: 13.5, fontWeight: '600'},
  });
}
