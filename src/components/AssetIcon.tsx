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

function trustWalletChain(chainKey: TradeChain): string | null {
  const map: Partial<Record<TradeChain, string>> = {
    ethereum: 'ethereum', base: 'base', bnb: 'smartchain', solana: 'solana',
    arbitrum: 'arbitrum', avalanche: 'avalanchec', polygon: 'polygon',
    optimism: 'optimism', zkSync: 'zksync', linea: 'linea', unichain: 'unichain',
  } as Partial<Record<TradeChain, string>>;
  return map[chainKey] ?? null;
}

async function resolveTokenLogo(chainKey: TradeChain, address: string): Promise<string | null> {
  const key = `${chainKey}:${address.toLowerCase()}`;
  if (logoCache.has(key)) return logoCache.get(key) ?? null;
  const pending = logoInFlight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`);
      if (response.ok) {
        const body = await response.json() as {pairs?: Array<{chainId?: string; liquidity?: {usd?: number}; info?: {imageUrl?: string}}>};
        const dexChain = dexScreenerChainForChain(chainKey);
        const pairs = (body.pairs ?? []).filter(p => p.chainId === dexChain && typeof p?.info?.imageUrl === 'string' && p.info.imageUrl);
        pairs.sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0));
        const image = pairs[0]?.info?.imageUrl;
        if (image) return image;
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
  const [failed, setFailed] = useState(false);
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  useEffect(() => {
    setFailed(false);
    setFetchedUrl(null);
    if (!imageUrl && chainKey && address) {
      resolveTokenLogo(chainKey, address).then(setFetchedUrl).catch(() => setFetchedUrl(null));
    }
  }, [imageUrl, chainKey, address]);
  const resolvedImageUrl = imageUrl || fetchedUrl;
  const s = StyleSheet.create({
    circle: {width: size, height: size, borderRadius: size / 2, backgroundColor: colors.pillBg, alignItems: 'center', justifyContent: 'center'},
    letter: {fontSize: size * 0.55, fontWeight: '700', color: colors.textPrimary},
    image: {width: size, height: size, borderRadius: size / 2},
  });
  if (resolvedImageUrl && !failed) {
    return <Image source={{uri: resolvedImageUrl}} style={s.image} onError={() => setFailed(true)} />;
  }
  return (
    <View style={s.circle}>
      <Text style={s.letter}>{symbol.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}
