// src/components/FloatingMangoDecor.tsx
//
// Ported verbatim from mango-mobile's own src/components/FloatingMangoDecor.tsx
// (itself a port of the same decorative effect the site's App.jsx and the
// browser extension already use) — same 8 positions/sizes/rotations/
// durations/delays, same 0.08 opacity, same theme-aware fill
// (colors.textPrimary), same real mango SVG path data. Not reinvented
// here: this app's own empty/error states should use the same brand
// element every other Mango surface does, not a mobile-only reinterpretation.
//
// Two real platform differences from the web version, both deliberate
// (carried over from mobile's own port):
// - CSS keyframes don't exist in React Native; the bob (translateY 0 to
//   -16 to 0, with a +6deg rotation nudge at the peak) is reproduced
//   with the Animated API instead — one Animated.Value per shape,
//   driving both transforms together via interpolation, looped forever
//   with each shape's own duration/delay exactly matching the site's
//   hardcoded table.
// - "prefers-reduced-motion" has no CSS media query equivalent here;
//   AccessibilityInfo.isReduceMotionEnabled() is the platform's real
//   equivalent, checked once on mount — shapes still render (same as
//   the web version), just static, if the OS setting is on.

import React, {useEffect, useMemo, useRef} from 'react';
import {AccessibilityInfo, Animated, Easing, StyleSheet, View} from 'react-native';
import {useTheme} from '../theme/ThemeContext';
import {MangoMark} from './MangoMark';

// Literal, fixed list — same as the site's own `shapes` array, not
// randomized. Every mount renders the exact same 8 positions/sizes/
// timings/rotations.
const SHAPES = [
  {top: '8%', left: '6%', size: 26, delay: 0, duration: 9000, rotate: -18},
  {top: '18%', left: '88%', size: 18, delay: 1200, duration: 11000, rotate: 24},
  {top: '62%', left: '4%', size: 20, delay: 2400, duration: 10000, rotate: 10},
  {top: '78%', left: '90%', size: 30, delay: 600, duration: 12000, rotate: -8},
  {top: '40%', left: '94%', size: 14, delay: 3000, duration: 8000, rotate: 30},
  {top: '30%', left: '50%', size: 16, delay: 1800, duration: 13000, rotate: -22},
  {top: '88%', left: '40%', size: 22, delay: 2100, duration: 9500, rotate: 16},
  {top: '50%', left: '2%', size: 24, delay: 900, duration: 11500, rotate: -12},
] as const;

function FloatingMango({shape, color, opacity}: {shape: (typeof SHAPES)[number]; color: string; opacity: number}) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (cancelled) {
        return;
      }
      reduceMotionRef.current = enabled;
      if (enabled) {
        return;
      }
      const half = shape.duration / 2;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(progress, {toValue: 1, duration: half, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
          Animated.timing(progress, {toValue: 0, duration: half, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
        ]),
      );
      Animated.sequence([Animated.delay(shape.delay), loop]).start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const translateY = progress.interpolate({inputRange: [0, 1], outputRange: [0, -16]});
  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [`${shape.rotate}deg`, `${shape.rotate + 6}deg`],
  });

  return (
    <Animated.View
      style={[styles.shape, {top: shape.top, left: shape.left, opacity, transform: [{translateY}, {rotate}]}]}>
      <MangoMark size={shape.size} color={color} />
    </Animated.View>
  );
}

export function FloatingMangoDecor() {
  const {colors, mode} = useTheme();
  const shapes = useMemo(() => SHAPES, []);
  // Same 0.08 mobile/site both use on a dark ground, where a light tint
  // reads clearly — but that same 8% of a near-black fill on pure WHITE
  // blends to almost nothing (255 -> ~238, barely off-white), a real
  // contrast asymmetry, not a porting bug. Bumped for light mode only so
  // it's actually visible there; dark mode is untouched.
  const opacity = mode === 'light' ? 0.14 : 0.08;
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.container]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {shapes.map((shape, i) => (
        <FloatingMango key={i} shape={shape} color={colors.textPrimary} opacity={opacity} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {overflow: 'hidden'},
  shape: {position: 'absolute'},
});
