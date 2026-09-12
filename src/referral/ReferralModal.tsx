// src/referral/ReferralModal.tsx
//
// Referral & points, opened from ProfileScreen's share button — the same
// real backend mango-mobile's own ReferralDashboardScreen.tsx already
// uses (see referralApi.ts's own header for why this is one shared
// points economy, not a separate Mango Pro program). Adapted to this
// app's bottom-sheet modal convention (ProfileScreen's own Deposit/
// Withdraw/Bio/Username modals) rather than a full screen, since Mango
// Pro has no push-navigation stack the way mobile's ScreenHeader assumes.
//
// Google/Particle sessions (privateKeyHex === '') can view real stats
// (a GET, no signature needed) but can't claim/set a handle here yet:
// that needs EIP-191 personal_sign through Particle's MPC signer
// (@particle-network/rn-auth-core's evm.personalSign), which nothing in
// this app has used or verified the wire format for yet — unlike
// sendTransaction/signAndSendTransaction (particleSigning.ts), whose
// formats were confirmed from multiple independent real sources before
// being wired into live trading. Guessing personalSign's exact payload
// shape here risks a signature the server silently rejects or, worse,
// one subtly wrong in a way that isn't caught until a real claim fails —
// so this is honestly gated instead, not guessed.

import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Modal, Share, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useTheme, type Colors} from '../theme/ThemeContext';
import {claimDailyPoints, getReferralStats, isValidReferralHandle, setReferralHandle, type ReferralStats} from './referralApi';

const SITE_URL = 'https://mangoprotocol.site';

function formatCooldown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
}

/** The real invite identifier for this wallet — the claimed handle once set, the raw address until then. Both resolve the same way server-side. */
function inviteIdentifier(stats: ReferralStats | null, address: string): string {
  return stats?.handle || address;
}

export function ReferralModal({
  visible,
  onClose,
  address,
  privateKeyHex,
}: {
  visible: boolean;
  onClose: () => void;
  address: string;
  /** Empty string for a Google/Particle session — see this file's own header for why signing is gated in that case. */
  privateKeyHex: string;
}) {
  const {colors} = useTheme();
  const styles = makeStyles(colors);
  const canSign = privateKeyHex.length > 0;

  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [claimingHandle, setClaimingHandle] = useState(false);
  const [handleError, setHandleError] = useState('');

  const refresh = useCallback(() => {
    getReferralStats(address)
      .then(data => {
        setStats(data);
        setCooldown(data.dailyCooldownSeconds || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function handleDailyClaim() {
    setError('');
    setClaiming(true);
    try {
      const result = await claimDailyPoints({address, privateKeyHex: privateKeyHex as `0x${string}`});
      setStats(s => (s ? {...s, points: s.points + result.pointsAwarded} : s));
      setCooldown(24 * 60 * 60);
    } catch (err) {
      const secondsUntilNextClaim = (err as {secondsUntilNextClaim?: number})?.secondsUntilNextClaim;
      setCooldown(secondsUntilNextClaim || 0);
      setError(err instanceof Error ? err.message : 'Could not claim right now.');
    } finally {
      setClaiming(false);
    }
  }

  async function handleClaimHandle() {
    const handle = handleInput.trim();
    setHandleError('');
    if (!isValidReferralHandle(handle)) {
      setHandleError('3-20 characters — letters, numbers, underscore only.');
      return;
    }
    setClaimingHandle(true);
    try {
      await setReferralHandle({address, handle, privateKeyHex: privateKeyHex as `0x${string}`});
      setStats(s => (s ? {...s, handle} : s));
      setHandleInput('');
    } catch (err) {
      setHandleError(err instanceof Error ? err.message : 'Could not claim that handle right now.');
    } finally {
      setClaimingHandle(false);
    }
  }

  function handleCopyLink() {
    Clipboard.setString(`${SITE_URL}/?ref=${inviteIdentifier(stats, address)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleShareLink() {
    Share.share({message: `Join me on Mango — ${SITE_URL}/?ref=${inviteIdentifier(stats, address)}`}).catch(() => {});
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalTitle}>Referral & points</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.modalClose}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.pointsCard}>
            <Text style={styles.pointsLabel}>Total points</Text>
            {loading ? (
              <ActivityIndicator color={colors.textPrimary} style={styles.pointsSpinner} />
            ) : (
              <Text style={styles.pointsValue}>{(stats?.points ?? 0).toLocaleString()}</Text>
            )}
            <Text style={styles.pointsSubtext}>
              {stats?.referralCount ?? 0} friend{stats?.referralCount === 1 ? '' : 's'} referred
            </Text>
          </View>

          {canSign ? (
            <>
              <Text style={styles.sectionLabel}>Daily check-in</Text>
              <View style={styles.card}>
                <Text style={styles.cardBody}>Come back every day to claim 150 points.</Text>
                <TouchableOpacity
                  style={[styles.claimButton, (claiming || cooldown > 0) && styles.claimButtonDisabled]}
                  onPress={handleDailyClaim}
                  disabled={claiming || cooldown > 0}
                  activeOpacity={0.85}>
                  {claiming ? (
                    <ActivityIndicator color={colors.ctaText} />
                  ) : (
                    <Text style={styles.claimButtonText}>{cooldown > 0 ? `Claim in ${formatCooldown(cooldown)}` : 'Claim 150 points'}</Text>
                  )}
                </TouchableOpacity>
                {!!error && <Text style={styles.errorText}>{error}</Text>}
              </View>

              <Text style={styles.sectionLabel}>Referral handle</Text>
              <View style={styles.card}>
                {stats?.handle ? (
                  <>
                    <Text style={styles.cardBody}>Your invite link uses your handle instead of a raw wallet address.</Text>
                    <View style={styles.handleBadge}>
                      <Text style={styles.handleBadgeText}>@{stats.handle}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.cardBody}>
                      Claim a handle so friends see something memorable instead of your raw wallet address — one per wallet, and it can't be
                      changed once set.
                    </Text>
                    <View style={styles.handleClaimRow}>
                      <TextInput
                        value={handleInput}
                        onChangeText={t => {
                          setHandleInput(t);
                          setHandleError('');
                        }}
                        placeholder="Mangoli"
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={20}
                        style={styles.handleInput}
                      />
                      <TouchableOpacity
                        style={[styles.handleClaimButton, (claimingHandle || !handleInput.trim()) && styles.claimButtonDisabled]}
                        onPress={handleClaimHandle}
                        disabled={claimingHandle || !handleInput.trim()}
                        activeOpacity={0.85}>
                        {claimingHandle ? <ActivityIndicator color={colors.ctaText} /> : <Text style={styles.claimButtonText}>Claim</Text>}
                      </TouchableOpacity>
                    </View>
                    {!!handleError && <Text style={styles.errorText}>{handleError}</Text>}
                  </>
                )}
              </View>
            </>
          ) : (
            <Text style={styles.modalHint}>
              Daily check-in and claiming a handle need your wallet's signing key directly — not yet available for Google sign-in accounts.
              Inviting friends with your link still works below.
            </Text>
          )}

          <Text style={styles.sectionLabel}>Invite friends</Text>
          <View style={styles.card}>
            <Text style={styles.cardBody}>Earn 100 points for every friend who joins with your link. They get 1000 points just for signing up.</Text>
            <Text style={styles.inviteLinkPreview} numberOfLines={1}>
              {SITE_URL.replace('https://', '')}/?ref={inviteIdentifier(stats, address)}
            </Text>
            <View style={styles.inviteRow}>
              <TouchableOpacity style={styles.inviteButton} onPress={handleCopyLink} activeOpacity={0.7}>
                <Text style={styles.inviteButtonText}>{copied ? 'Copied' : 'Copy link'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.inviteButton} onPress={handleShareLink} activeOpacity={0.7}>
                <Text style={styles.inviteButtonText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    modalBackdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)'},
    modalCard: {backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '88%'},
    modalHeaderRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16},
    modalTitle: {color: colors.textPrimary, fontSize: 18, fontWeight: '800'},
    modalClose: {color: colors.textMuted, fontSize: 13, fontWeight: '600'},
    modalHint: {color: colors.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 4, marginBottom: 4},

    pointsCard: {
      backgroundColor: colors.panel,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderRadius: 20,
      paddingVertical: 22,
      alignItems: 'center',
    },
    pointsLabel: {color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4},
    pointsValue: {color: colors.textPrimary, fontSize: 36, fontWeight: '800', marginTop: 8},
    pointsSpinner: {marginTop: 10, marginBottom: 10},
    pointsSubtext: {color: colors.textSecondary, fontSize: 12.5, marginTop: 6},

    sectionLabel: {color: colors.textMuted, fontSize: 11.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 18, marginBottom: 8},
    card: {backgroundColor: colors.panel, borderColor: colors.panelBorder, borderWidth: 1, borderRadius: 16, padding: 14},
    cardBody: {color: colors.textSecondary, fontSize: 13, lineHeight: 18},

    claimButton: {backgroundColor: colors.ctaBg, borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 12},
    claimButtonDisabled: {opacity: 0.5},
    claimButtonText: {color: colors.ctaText, fontSize: 14, fontWeight: '700'},
    errorText: {color: colors.danger, fontSize: 12, marginTop: 8},

    inviteLinkPreview: {color: colors.textMuted, fontSize: 11.5, fontFamily: 'monospace', marginTop: 10},
    handleBadge: {alignSelf: 'flex-start', backgroundColor: colors.pillBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginTop: 10},
    handleBadgeText: {color: colors.textPrimary, fontSize: 14.5, fontWeight: '700'},
    handleClaimRow: {flexDirection: 'row', gap: 10, marginTop: 12},
    handleInput: {
      flex: 1,
      backgroundColor: colors.input,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 11,
      color: colors.textPrimary,
      fontSize: 14,
    },
    handleClaimButton: {backgroundColor: colors.ctaBg, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center'},

    inviteRow: {flexDirection: 'row', gap: 10, marginTop: 12},
    inviteButton: {flex: 1, backgroundColor: colors.pillBg, borderRadius: 14, paddingVertical: 11, alignItems: 'center'},
    inviteButtonText: {color: colors.textPrimary, fontSize: 13.5, fontWeight: '700'},
  });
}
