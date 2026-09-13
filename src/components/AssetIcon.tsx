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

import {useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../theme/ThemeContext';

export function AssetIcon({symbol, imageUrl, size = 16}: {symbol: string; imageUrl?: string | null; size?: number}) {
  const {colors} = useTheme();
  const [failed, setFailed] = useState(false);
  const s = StyleSheet.create({
    circle: {width: size, height: size, borderRadius: size / 2, backgroundColor: colors.pillBg, alignItems: 'center', justifyContent: 'center'},
    letter: {fontSize: size * 0.55, fontWeight: '700', color: colors.textPrimary},
    image: {width: size, height: size, borderRadius: size / 2},
  });
  if (imageUrl && !failed) {
    return <Image source={{uri: imageUrl}} style={s.image} onError={() => setFailed(true)} />;
  }
  return (
    <View style={s.circle}>
      <Text style={s.letter}>{symbol.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}
