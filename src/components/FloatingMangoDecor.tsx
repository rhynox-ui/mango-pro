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
import Svg, {Path} from 'react-native-svg';
import {useTheme} from '../theme/ThemeContext';

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

// Same 4 paths as src/MangoLogo.jsx on the site/extension — two small
// leaf/stem accents, the main body fill (in the passed color), and a
// white 16%-opacity overlay path for the body's two-tone highlight.
// Kept as literal path data (not re-derived) so this is pixel-identical
// to the shared brand mark, not a redrawn approximation.
function MangoMarkSvg({size, color}: {size: number; color: string}) {
  return (
    <Svg width={size} height={size * 0.86} viewBox="0 0 70 60">
      <Path d="M27 4c1.5-2 4-3.5 6-3.5-.3 3-2.3 5.8-5.3 7-1-1-1.2-2.3-0.7-3.5Z" fill={color} />
      <Path d="M29 6c6-2 13 0.5 16 6.5-5.5 3-13 1.5-16.5-3-0.4-1.3-0.2-2.5 0.5-3.5Z" fill={color} />
      <Path d="M35 12c11 0 20 10.5 20 24s-10 24-20 24-20-10.5-20-24 9-24 20-24Z" fill={color} />
      <Path
        d="M35 12c2.5 0 4.8 0.4 6.9 1.2-7.7 2.6-13.4 11.6-13.4 22.3s5.7 19.7 13.4 22.3c-2.1 0.8-4.4 1.2-6.9 1.2-11 0-20-10.5-20-24s9-24 20-24Z"
        fill="#FFFFFF"
        opacity={0.16}
      />
    </Svg>
  );
}

function FloatingMango({shape, color}: {shape: (typeof SHAPES)[number]; color: string}) {
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
      style={[styles.shape, {top: shape.top, left: shape.left, transform: [{translateY}, {rotate}]}]}>
      <MangoMarkSvg size={shape.size} color={color} />
    </Animated.View>
  );
}

export function FloatingMangoDecor() {
  const {colors} = useTheme();
  const shapes = useMemo(() => SHAPES, []);
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.container]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {shapes.map((shape, i) => (
        <FloatingMango key={i} shape={shape} color={colors.textPrimary} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {overflow: 'hidden'},
  shape: {position: 'absolute', opacity: 0.08},
});
