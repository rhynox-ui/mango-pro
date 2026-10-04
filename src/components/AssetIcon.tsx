// src/components/AssetIcon.tsx
//
// Extracted from TokenTradeScreen.tsx's own local component of the same
// name (unchanged behavior) so ProfileScreen's Open Positions list can
// show the exact same real-logo-or-lettered-badge treatment instead of
// a second, drifting copy.
//
// The actual asset's own logo where one is real (a searched/discovered
// token's imageUrl, or a trade-history entry's own tokenImageUrl —
// never refetched here), falling back to a lettered badge rather than a
// wrong or fabricated icon when there isn't one (a bare DemoToken, an
// older history entry from before tokenImageUrl existed, or an image
// URL that 404s).

import {useEffect, useMemo, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../theme/ThemeContext';
import type {TradeChain} from '../core/chainData';
import {dexScreenerChainForChain} from '../core/dexScreener';

const logoCache = new Map<string, string | null>();
const logoInFlight = new Map<string, Promise<string | null>>();

function logoCacheKey(chainKey: TradeChain, address: string): string {
  // EVM addresses are case-insensitive; Solana base58 addresses are not.
  return `${chainKey}:${chainKey === 'solana' ? address : address.toLowerCase()}`;
}

function trustWalletChain(chainKey: TradeChain): string | null {
  const map: Partial<Record<TradeChain, string>> = {
    ethereum: 'ethereum', base: 'base', bnb: 'smartchain', solana: 'solana',
    arbitrum: 'arbitrum', avalanche: 'avalanchec', polygon: 'polygon',
    optimism: 'optimism', zkSync: 'zksync', linea: 'linea', unichain: 'unichain',
  } as Partial<Record<TradeChain, string>>;
  return map[chainKey] ?? null;
}

async function resolveTokenLogo(chainKey: TradeChain, address: string): Promise<string | null> {
  const key = logoCacheKey(chainKey, address);
  if (logoCache.has(key)) return logoCache.get(key) ?? null;
  const pending = logoInFlight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`);
      if (response.ok) {
        const body = await response.json() as {pairs?: Array<{chainId?: string; liquidity?: {usd?: number}; info?: {imageUrl?: string}}>};
        const dexChain = dexScreenerChainForChain(chainKey);
        const pairs = (body.pairs ?? []).filter(p => p.chainId === dexChain);
        let bestImage: string | null = null;
        let bestLiquidity = -1;
        for (const pair of pairs) {
          const candidate = typeof pair?.info?.imageUrl === 'string' && pair.info.imageUrl ? pair.info.imageUrl : null;
          if (!candidate) continue;
          const liquidity = Number(pair?.liquidity?.usd ?? 0);
          const rankedLiquidity = Number.isFinite(liquidity) ? liquidity : 0;
          if (!bestImage || rankedLiquidity > bestLiquidity) {
            bestImage = candidate;
            bestLiquidity = rankedLiquidity;
          }
        }
        if (bestImage) return bestImage;
      }
    } catch {}
    const trustChain = trustWalletChain(chainKey);
    if (trustChain) return `https://assets-cdn.trustwallet.com/blockchains/${trustChain}/assets/${address}/logo.png`;
    return null;
  })().then(url => { logoCache.set(key, url); return url; }).finally(() => logoInFlight.delete(key));
  logoInFlight.set(key, promise);
  return promise;
}

export function AssetIcon({symbol, imageUrl, chainKey, address, size = 16}: {symbol: string; imageUrl?: string | null; chainKey?: TradeChain; address?: string; size?: number}) {
  const {colors} = useTheme();
  const [sourceFailed, setSourceFailed] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  useEffect(() => {
    setSourceFailed(false);
    setFallbackUrl(null);
    setFallbackFailed(false);
    if (chainKey && address && !imageUrl) {
      resolveTokenLogo(chainKey, address).then(setFallbackUrl).catch(() => setFallbackUrl(null));
    }
  }, [imageUrl, chainKey, address]);

  const s = StyleSheet.create({
    circle: {width: size, height: size, borderRadius: size / 2, backgroundColor: colors.pillBg, alignItems: 'center', justifyContent: 'center'},
    letter: {fontSize: size * 0.55, fontWeight: '700', color: colors.textPrimary},
    image: {width: size, height: size, borderRadius: size / 2},
  });

  // Prefer the token's supplied logo. If it fails, switch to the address-
  // resolved exact-chain fallback. A failed fallback is terminal for this
  // render so a broken URL cannot cause an image/error loop.
  const activeUrl = sourceFailed ? fallbackUrl : imageUrl || fallbackUrl;
  const showingFallback = sourceFailed || !imageUrl;

  if (activeUrl && !fallbackFailed) {
    return <Image
      source={{uri: activeUrl}}
      style={s.image}
      onError={() => {
        if (showingFallback) {
          setFallbackFailed(true);
        } else {
          setSourceFailed(true);
          if (chainKey && address) {
            resolveTokenLogo(chainKey, address).then(url => {
              setFallbackUrl(url);
              if (!url) setFallbackFailed(true);
            }).catch(() => setFallbackFailed(true));
          } else {
            setFallbackFailed(true);
          }
        }
      }}
    />;
  }

  return (
    <View style={s.circle}>
      <Text style={s.letter}>{symbol.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}
