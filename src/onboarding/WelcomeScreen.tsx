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
import {ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
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

function GoogleG({size}: {size: number}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.4 0 6.4 1.2 8.8 3.4l6.5-6.5C35.3 2.5 30 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.6 5.9C12.1 13 17.6 9.5 24 9.5Z" />
      <Path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.6c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.8-9.8 6.8-17.4Z" />
      <Path fill="#FBBC05" d="M10.2 19.1a14.5 14.5 0 0 0 0 9.8l-7.6 5.9a24 24 0 0 1 0-21.6l7.6 5.9Z" />
      <Path fill="#34A853" d="M24 48c6 0 11.3-2 15-5.4l-7.3-5.7c-2 1.4-4.6 2.2-7.7 2.2-6.4 0-11.9-3.5-13.8-8.7l-7.6 5.9C6.5 42.6 14.6 48 24 48Z" />
    </Svg>
  );
}

export function WelcomeScreen({
  onCreate,
  onImport,
  onGoogleLogin,
  googleLoading,
  googleError,
}: {
  onCreate: () => void;
  onImport: () => void;
  onGoogleLogin: () => void;
  googleLoading?: boolean;
  googleError?: string | null;
}) {
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
        {!!googleError && <Text style={styles.errorText}>{googleError}</Text>}
        <TouchableOpacity
          onPress={onGoogleLogin}
          activeOpacity={0.85}
          disabled={googleLoading}
          style={[styles.secondaryButton, styles.googleButton, googleLoading && styles.buttonDisabled]}>
          {googleLoading ? <ActivityIndicator color={colors.textPrimary} /> : <GoogleG size={18} />}
          <Text style={styles.secondaryButtonText}>Continue with Google</Text>
        </TouchableOpacity>
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>
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
    googleButton: {flexDirection: 'row', gap: 10},
    buttonDisabled: {opacity: 0.6},
    divider: {flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2},
    dividerLine: {flex: 1, height: 1, backgroundColor: colors.panelBorder},
    dividerText: {color: colors.textSecondary, fontSize: 12, fontWeight: '600'},
    errorText: {color: colors.danger, fontSize: 12, textAlign: 'center', marginBottom: 2},
    footer: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12},
    footerText: {color: colors.textSecondary, fontSize: 12},
  });
}
