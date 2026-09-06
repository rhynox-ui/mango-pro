// src/screens/SolanaDevnetTestScreen.tsx
//
// A real, isolated devnet sign-and-send test for Particle's Solana
// signing path (particleSigning.ts's signAndSendSolanaTransactionViaParticle)
// — built specifically to prove that path on a real device BEFORE it's
// trusted with real funds in TokenTradeScreen.tsx/ProfileScreen.tsx.
// Devnet only, never mainnet: a self-transfer of a tiny, fixed lamport
// amount (the recipient IS the sender — Solana allows this, and it
// means the test needs no second address, no balance beyond the
// transfer amount + fee, and can never move real value even by
// accident, since devnet SOL has none).
//
// Only reachable from Settings, and only shown there for a Google-login
// session (see SettingsScreen.tsx) — this has nothing to prove for a
// local seed-phrase session, which already signs Solana transactions
// directly.

import {useState} from 'react';
import {ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {ChevronLeftIcon} from '../components/icons';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {useSession} from '../wallet/SessionContext';
import {signAndSendSolanaTransactionViaParticle} from '../wallet/particleSigning';

const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const TEST_LAMPORTS = 1000; // ~0.000001 SOL — a real transfer amount, negligible even on mainnet, and this never touches mainnet anyway.

type TestState = {status: 'idle' | 'running' | 'success' | 'error'; signature?: string; error?: string};

export function SolanaDevnetTestScreen({onBack}: {onBack: () => void}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const {session} = useSession();
  const [state, setState] = useState<TestState>({status: 'idle'});

  async function runTest() {
    if (!session) return;
    setState({status: 'running'});
    try {
      const {Connection, PublicKey, SystemProgram, Transaction} = await import('@solana/web3.js');
      const address = new PublicKey(session.solana.address);
      const connection = new Connection(DEVNET_RPC_URL, 'confirmed');

      const {blockhash, lastValidBlockHeight} = await connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction({feePayer: address, blockhash, lastValidBlockHeight}).add(
        SystemProgram.transfer({fromPubkey: address, toPubkey: address, lamports: TEST_LAMPORTS}),
      );
      // Unsigned on purpose — Particle's own MPC signer supplies the
      // signature, this app never sees a private key for this session
      // at all. requireAllSignatures/verifySignatures both false is
      // what makes .serialize() accept a transaction with no signature
      // yet.
      const serialized = transaction.serialize({requireAllSignatures: false, verifySignatures: false});

      const signature = await signAndSendSolanaTransactionViaParticle(serialized);
      await connection.confirmTransaction({signature, blockhash, lastValidBlockHeight}, 'confirmed');
      setState({status: 'success', signature});
    } catch (err) {
      setState({status: 'error', error: err instanceof Error ? err.message : String(err)});
    }
  }

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backButton}>
        <ChevronLeftIcon color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.title}>Solana signing test</Text>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>
          Sends {TEST_LAMPORTS} lamports on Solana devnet from this account back to itself, signed through Particle's own MPC
          signer — proves the signing path works before it's trusted with real trades or withdrawals. Devnet only; never
          touches mainnet funds.
        </Text>

        {!session ? (
          <Text style={styles.hint}>Unlock the wallet to run this test.</Text>
        ) : (
          <TouchableOpacity onPress={runTest} activeOpacity={0.85} disabled={state.status === 'running'} style={[styles.button, state.status === 'running' && styles.buttonDisabled]}>
            {state.status === 'running' ? <ActivityIndicator color={colors.ctaText} /> : <Text style={styles.buttonText}>Run devnet test</Text>}
          </TouchableOpacity>
        )}

        {state.status === 'success' && state.signature && (
          <View style={styles.resultBox}>
            <Text style={styles.resultSuccess}>Signed and confirmed.</Text>
            <TouchableOpacity onPress={() => Linking.openURL(`https://solscan.io/tx/${state.signature}?cluster=devnet`)}>
              <Text style={styles.resultLink}>View on Solscan (devnet) →</Text>
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
