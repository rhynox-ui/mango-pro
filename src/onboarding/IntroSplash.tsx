// src/onboarding/IntroSplash.tsx
//
// Ported from mango-mobile's own IntroSplash.tsx — the "reflect the
// mango pro graphic" ask turned out to already have a real, shipped
// answer in the sibling app: not a video (Hermes/RN has no built-in
// video decoding, and there's no actual Mango video footage to embed
// anyway) but a short, code-driven brand moment using React Native's
// own Animated API — the real mark (src/assets/mango-mark.png), a
// wordmark, and an accent underline animating in over a plain white
// ground, using the light palette for the brand mark itself regardless
// of which theme the rest of the app resolves to (the white overlay's
// fade-out at the end is what actually reveals the resolved theme).
//
// Runs once per cold start on a brand-new install (no vault yet), 6.0s
// total, then calls onDone. A returning user (vault already exists —
// they just want to unlock) gets `quick`, a ~0.9s version of the same
// sequence — mobile's own testing found the full 6s on every cold open
// made the app feel stuck rather than "has a nice intro," on top of the
// password screen's own necessarily-slow PBKDF2 unlock. App.tsx decides
// which mode based on the (much faster) hasVault() check completing
// before this even mounts.

import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {useTheme, type Colors} from '../theme/ThemeContext';

const MANGO_MARK = require('../assets/mango-mark.png');

// Same "back out" overshoot curve for both the mark and the wordmark —
// a small, deliberate bounce rather than a flat linear reveal.
const REVEAL_EASING = Easing.bezier(0.34, 1.56, 0.64, 1);

const LIGHT = {
  bg: '#FFFFFF',
  ink: '#0A0A0B',
  inkSoft: '#6B6B70',
};

export function IntroSplash({onDone, quick}: {onDone: () => void; quick?: boolean}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const markScale = useRef(new Animated.Value(0.8)).current;
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkScale = useRef(new Animated.Value(0.9)).current;
  const barScale = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Same beats, same order, just compressed ~6.5x for returning users.
    const t = quick
      ? {markDelay: 40, markDur: 220, wordDelay: 160, wordDur: 220, barDelay: 320, barDur: 120, tagDelay: 380, tagDur: 120, fadeDelay: 620, fadeDur: 220}
      : {markDelay: 300, markDur: 550, wordDelay: 900, wordDur: 550, barDelay: 1850, barDur: 350, tagDelay: 2350, tagDur: 420, fadeDelay: 5450, fadeDur: 550};
    const sequence = Animated.parallel([
      Animated.sequence([
        Animated.delay(t.markDelay),
        Animated.parallel([
          Animated.timing(markOpacity, {toValue: 1, duration: t.markDur, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
          Animated.timing(markScale, {toValue: 1, duration: t.markDur, easing: REVEAL_EASING, useNativeDriver: true}),
        ]),
      ]),
      Animated.sequence([
        Animated.delay(t.wordDelay),
        Animated.parallel([
          Animated.timing(wordmarkOpacity, {toValue: 1, duration: t.wordDur, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
          Animated.timing(wordmarkScale, {toValue: 1, duration: t.wordDur, easing: REVEAL_EASING, useNativeDriver: true}),
        ]),
      ]),
      Animated.sequence([
        Animated.delay(t.barDelay),
        Animated.timing(barScale, {toValue: 1, duration: t.barDur, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
      ]),
      Animated.sequence([
        Animated.delay(t.tagDelay),
        Animated.timing(taglineOpacity, {toValue: 1, duration: t.tagDur, easing: Easing.out(Easing.cubic), useNativeDriver: true}),
      ]),
      Animated.sequence([
        Animated.delay(t.fadeDelay),
        Animated.timing(overlayOpacity, {toValue: 0, duration: t.fadeDur, easing: Easing.in(Easing.cubic), useNativeDriver: true}),
      ]),
    ]);
    sequence.start(({finished}) => {
      if (finished) {
        onDone();
      }
    });
    return () => sequence.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.overlay, {opacity: overlayOpacity}]}>
        <Animated.Image
          source={MANGO_MARK}
          resizeMode="contain"
          style={[styles.mark, {opacity: markOpacity, transform: [{scale: markScale}]}]}
        />
        <Animated.View style={[styles.wordmarkRow, {opacity: wordmarkOpacity, transform: [{scale: wordmarkScale}]}]}>
          <Animated.Text style={styles.wordmark}>Mango</Animated.Text>
          <View style={styles.proBadge}>
            <Animated.Text style={styles.proBadgeText}>PRO</Animated.Text>
          </View>
        </Animated.View>
        <Animated.View style={[styles.bar, {transform: [{scaleX: barScale}]}]} />
        <Animated.Text style={[styles.tagline, {opacity: taglineOpacity}]}>
          Search any token.{'\n'}Trade on any chain.
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    overlay: {
      flex: 1,
      backgroundColor: LIGHT.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mark: {
      width: 52,
      height: 52,
      marginBottom: 10,
    },
    wordmarkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    wordmark: {
      color: LIGHT.ink,
      fontSize: 44,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    proBadge: {
      borderWidth: 1.5,
      borderColor: LIGHT.ink,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
      marginTop: 10,
    },
    proBadgeText: {
      color: LIGHT.ink,
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    bar: {
      width: 46,
      height: 3,
      borderRadius: 2,
      backgroundColor: LIGHT.ink,
      marginTop: 14,
      marginBottom: 18,
    },
    tagline: {
      color: LIGHT.inkSoft,
      fontSize: 13,
      textAlign: 'center',
      lineHeight: 19,
    },
  });
}
