// src/onboarding/WelcomeScreen.tsx
//
// Simplified from mango-mobile's own WelcomeScreen.tsx: that version is
// built around a bespoke illustration asset (mango-hero.png) measured
// pixel-for-pixel off a supplied reference design. Mango Pro doesn't
// have that same full hero illustration, but it does have the real
// mango mark (src/assets/mango-mark.png — same require()+Image
// resizeMode="contain" pattern mobile's own WelcomeScreen/LockedScreen
// use for their MANGO_MARK), so this uses that as the hero instead of
// a wordmark placeholder. Same two actions, same "self-custodial"
// reassurance, same monochrome palette.

import {useMemo} from 'react';
import {Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {useTheme, type Colors} from '../theme/ThemeContext';

const MANGO_MARK = require('../assets/mango-mark.png');

function ShieldCheck({color, size}: {color: string; size: number}) {
  return (
    <Svg width={size} height={size * 1.13} viewBox="0 0 24 26">
      <Path d="M12 1.5 21 5v8.2c0 5.6-3.8 9.3-9 11.3-5.2-2-9-5.7-9-11.3V5l9-3.5Z" stroke={color} strokeWidth={1.9} fill="none" strokeLinejoin="round" />
      <Path d="M8 12.8l2.8 2.8L16.4 10" stroke={color} strokeWidth={1.9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function WelcomeScreen({onCreate, onImport}: {onCreate: () => void; onImport: () => void}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.screen}>
      <View style={styles.spacer} />

      <View style={styles.hero}>
        <Image source={MANGO_MARK} style={styles.markImage} resizeMode="contain" />
        <Text style={styles.headline}>Start your journey</Text>
        <Text style={styles.subtitle}>New here? Let's build your wallet.</Text>
        <Text style={styles.subtitle}>Already have one? Just import it.</Text>
      </View>

      <View style={styles.spacer} />

      <View style={styles.actions}>
        <TouchableOpacity onPress={onCreate} activeOpacity={0.85} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Create new wallet</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onImport} activeOpacity={0.85} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Import existing wallet</Text>
        </TouchableOpacity>
        <View style={styles.footer}>
          <ShieldCheck color={colors.textSecondary} size={13} />
          <Text style={styles.footerText}>Self-custodial. You control your keys.</Text>
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 28},
    spacer: {flex: 1},
    hero: {alignItems: 'center', gap: 10},
    markImage: {width: 96, height: 96, marginBottom: 8},
    headline: {color: colors.textPrimary, fontSize: 28, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5},
    subtitle: {color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20},
    actions: {paddingBottom: 32, gap: 12},
    primaryButton: {height: 54, borderRadius: 27, backgroundColor: colors.ctaBg, alignItems: 'center', justifyContent: 'center'},
    primaryButtonText: {color: colors.ctaText, fontSize: 15, fontWeight: '700'},
    secondaryButton: {height: 54, borderRadius: 27, borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center'},
    secondaryButtonText: {color: colors.textPrimary, fontSize: 15, fontWeight: '700'},
    footer: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12},
    footerText: {color: colors.textSecondary, fontSize: 12},
  });
}
