// src/components/TokenChartPanel.tsx
//
// Ported directly from mango-mobile's own src/components/DexScreenerChart.tsx
// — same WebView embed, same fixed-origin navigation lockdown, same
// "no self-drawn interval pills or MC/Vol chips" fix (DexScreener's own
// embedded page already renders its own timeframe selector and its own
// volume/price header, so a second copy here would be the exact
// duplicate-controls bug already fixed twice elsewhere in this family of
// apps: once on mobile's own Swap chart, once on the site's).
//
// Holders button: ported from mobile's own Holders button (GoPlus
// Security), the one real omission from an earlier pass here — now
// wired to src/core/goplusTokenSecurity.ts. Rendered as a small anchored
// popover next to its own button (a Modal, since RN has no CSS stacking
// context to fight the way the site once did — that repo's own first
// pass at this made the mistake of painting the panel `absolute inset-0`
// INSIDE the chart's own box, hiding the whole chart behind a near-
// opaque layer; ported here having already learned that lesson, not
// repeating it), using this app's own theme tokens (not the site's other
// bug — a hardcoded dark panel color that read as wrong on a light
// theme) so it matches whichever mode the app is in.

import {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {WebView} from 'react-native-webview';
import type {ShouldStartLoadRequest} from 'react-native-webview/lib/WebViewTypes';
import {MAINNET_CHAIN_IDS, type ChainKey} from '../core/chainData';
import {dexScreenerEmbedUrl, resolveDexScreenerPair} from '../core/dexScreener';
import {checkSolanaTokenSecurity, checkTokenSecurity, type TokenSecuritySummary} from '../core/goplusTokenSecurity';
import {useTheme, type Colors} from '../theme/ThemeContext';

const CHART_BG = '#0B0B0D';
const CHART_AXIS_TEXT = '#7A7A80';

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function TokenChartPanel({chainKey, tokenAddress}: {chainKey: ChainKey; tokenAddress: string | null}) {
  const {colors, mode} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [pair, setPair] = useState<{chainId: string; pairAddress: string} | null>(null);
  const [resolving, setResolving] = useState(true);
  const [security, setSecurity] = useState<TokenSecuritySummary | null>(null);
  const [holdersOpen, setHoldersOpen] = useState(false);

  // Resolved per chain+token only — there's no interval control here to
  // re-trigger this on (see the header comment above), so this effect
  // has exactly one reason to re-run.
  useEffect(() => {
    if (!tokenAddress) {
      setPair(null);
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    resolveDexScreenerPair({chainKey, tokenAddress}).then(result => {
      if (cancelled) return;
      setPair(result);
      setResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, [chainKey, tokenAddress]);

  useEffect(() => {
    if (!tokenAddress) {
      setSecurity(null);
      return;
    }
    let cancelled = false;
    const lookup = chainKey === 'solana' ? checkSolanaTokenSecurity(tokenAddress) : checkTokenSecurity(MAINNET_CHAIN_IDS[chainKey], tokenAddress);
    lookup.then(result => {
      if (!cancelled) setSecurity(result);
    });
    return () => {
      cancelled = true;
    };
  }, [chainKey, tokenAddress]);

  const embedUrl = pair ? dexScreenerEmbedUrl({chainId: pair.chainId, pairAddress: pair.pairAddress, theme: mode}) : null;
  const holders = security?.holders ?? null;
  const holderCount = security?.holderCount ?? null;
  const hasHolders = (holders?.length ?? 0) > 0;

  // The embed is a third-party page inside this app's own chrome, so it
  // gets no freedom to navigate anywhere else — same posture mobile's
  // BrowserScreen takes for pages it doesn't control, applied here where
  // there is no address bar to show the user where they ended up.
  function onShouldStartLoadWithRequest(request: ShouldStartLoadRequest): boolean {
    return /^https:\/\/([a-z0-9-]+\.)*dexscreener\.com\//i.test(request.url);
  }

  return (
    <View style={styles.wrap}>
      {(holderCount != null || hasHolders) && (
        <View style={styles.holdersRow}>
          <TouchableOpacity style={styles.holdersButton} onPress={() => setHoldersOpen(true)} activeOpacity={0.7}>
            <Text style={styles.holdersButtonText}>{holderCount != null ? `Holders ${fmtCompact(holderCount)}` : 'Top holders'} ▾</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.chartArea}>
        {resolving && <ActivityIndicator color={CHART_AXIS_TEXT} style={styles.centered} />}
        {!resolving && !embedUrl && (
          <Text style={styles.errorText}>
            {tokenAddress ? "DexScreener hasn't indexed a pair for this token on this network yet." : 'Pick a token to see its chart.'}
          </Text>
        )}
        {!!embedUrl && (
          // Keyed on the full URL so a token/theme change actually
          // reloads the embed — react-native-webview treats `source` as
          // the INITIAL url on Android and won't renavigate for a
          // changed uri alone.
          <WebView
            key={embedUrl}
            source={{uri: embedUrl}}
            style={styles.webview}
            containerStyle={styles.webviewContainer}
            originWhitelist={['https://*']}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            javaScriptEnabled
            domStorageEnabled
            // The panel is a fixed-size chart, not a page — letting it
            // scroll internally would fight the swipe that scrubs
            // DexScreener's own crosshair.
            scrollEnabled={false}
            backgroundColor={CHART_BG}
            renderLoading={() => <ActivityIndicator color={CHART_AXIS_TEXT} style={styles.centered} />}
            startInLoadingState
          />
        )}
      </View>

      <Modal visible={holdersOpen} transparent animationType="fade" onRequestClose={() => setHoldersOpen(false)}>
        <TouchableOpacity style={styles.holdersBackdrop} activeOpacity={1} onPress={() => setHoldersOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.holdersCard} onPress={() => {}}>
            <View style={styles.holdersHeader}>
              <Text style={styles.holdersTitle}>Top holders</Text>
              <TouchableOpacity onPress={() => setHoldersOpen(false)}>
                <Text style={styles.holdersClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.holdersList}>
              {!hasHolders ? (
                <Text style={styles.holdersEmpty}>No holder data available for this token right now.</Text>
              ) : (
                holders!.map((h, i) => (
                  <View key={h.address} style={styles.holderRow}>
                    <View style={styles.holderInfo}>
                      <Text style={styles.holderRank}>#{i + 1}</Text>
                      <View style={styles.holderAddressCol}>
                        <Text style={styles.holderAddress} numberOfLines={1}>
                          {h.tag ?? `${h.address.slice(0, 6)}…${h.address.slice(-4)}`}
                        </Text>
                        {(h.isLocked || h.isContract) && (
                          <Text style={styles.holderTag}>{[h.isLocked && 'Locked', h.isContract && 'Contract'].filter(Boolean).join(' · ')}</Text>
                        )}
                      </View>
                    </View>
                    <Text style={styles.holderPercent}>{h.percent != null ? `${h.percent.toFixed(2)}%` : '—'}</Text>
                  </View>
                ))
              )}
            </View>
            {/* Solana's wording is a real distinction, not pedantry:
                GoPlus identifies Solana holders by TOKEN ACCOUNT and
                carries no owner field, so these are not wallet
                addresses. */}
            <Text style={styles.holdersFooter}>Top 10 {chainKey === 'solana' ? 'token accounts' : 'holders'} only, via GoPlus Security — not the full holder list.</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: {flex: 1, minHeight: 390, overflow: 'hidden'},
    holdersRow: {flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6},
    holdersButton: {backgroundColor: colors.pillBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5},
    holdersButtonText: {color: colors.textPrimary, fontSize: 10.5, fontWeight: '700'},
    chartArea: {
      flex: 1,
      minHeight: 390,
      justifyContent: 'center',
      backgroundColor: CHART_BG,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.panelBorder,
      overflow: 'hidden',
    },
    webview: {flex: 1, backgroundColor: CHART_BG},
    webviewContainer: {flex: 1, backgroundColor: CHART_BG},
    centered: {alignSelf: 'center'},
    errorText: {color: CHART_AXIS_TEXT, fontSize: 12, textAlign: 'center', marginHorizontal: 16},

    holdersBackdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24},
    holdersCard: {
      backgroundColor: colors.panel,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderRadius: 16,
      maxHeight: '75%',
      overflow: 'hidden',
    },
    holdersHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.panelBorder,
    },
    holdersTitle: {color: colors.textPrimary, fontSize: 14, fontWeight: '800'},
    holdersClose: {color: colors.textSecondary, fontSize: 12, fontWeight: '600'},
    holdersList: {paddingHorizontal: 16},
    holdersEmpty: {color: colors.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 24},
    holderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    holderInfo: {flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0},
    holderRank: {color: colors.textMuted, fontSize: 11.5, fontWeight: '700', width: 24},
    holderAddressCol: {flex: 1, minWidth: 0},
    holderAddress: {color: colors.textPrimary, fontSize: 12.5, fontFamily: 'monospace'},
    holderTag: {color: colors.textMuted, fontSize: 10.5, marginTop: 2},
    holderPercent: {color: colors.textPrimary, fontSize: 12.5, fontWeight: '700', fontFamily: 'monospace'},
    holdersFooter: {color: colors.textMuted, fontSize: 10, textAlign: 'center', paddingHorizontal: 16, paddingVertical: 12},
  });
}
