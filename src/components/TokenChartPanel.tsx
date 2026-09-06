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
// One real omission versus the source, called out rather than faked:
// mobile's version also renders a "Holders" button wired to
// goplusTokenSecurity.js, which hasn't been ported into mango-pro yet
// (build plan §5 — GoPlus + the Solana-native check land with Phase 1's
// security work). Reproducing that button with no real holder data would
// just be a dead control, so it's left out until that port exists.

import {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {WebView} from 'react-native-webview';
import type {ShouldStartLoadRequest} from 'react-native-webview/lib/WebViewTypes';
import type {ChainKey} from '../core/chainData';
import {dexScreenerEmbedUrl, resolveDexScreenerPair} from '../core/dexScreener';
import {useTheme, type Colors} from '../theme/ThemeContext';

const CHART_BG = '#0B0B0D';
const CHART_AXIS_TEXT = '#7A7A80';

export function TokenChartPanel({chainKey, tokenAddress}: {chainKey: ChainKey; tokenAddress: string | null}) {
  const {colors, mode} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [pair, setPair] = useState<{chainId: string; pairAddress: string} | null>(null);
  const [resolving, setResolving] = useState(true);

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

  const embedUrl = pair ? dexScreenerEmbedUrl({chainId: pair.chainId, pairAddress: pair.pairAddress, theme: mode}) : null;

  // The embed is a third-party page inside this app's own chrome, so it
  // gets no freedom to navigate anywhere else — same posture mobile's
  // BrowserScreen takes for pages it doesn't control, applied here where
  // there is no address bar to show the user where they ended up.
  function onShouldStartLoadWithRequest(request: ShouldStartLoadRequest): boolean {
    return /^https:\/\/([a-z0-9-]+\.)*dexscreener\.com\//i.test(request.url);
  }

  return (
    <View style={styles.wrap}>
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
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: {flex: 1, minHeight: 390, overflow: 'hidden'},
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
  });
}
