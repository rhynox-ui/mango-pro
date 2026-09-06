// src/components/BottomSheet.tsx
//
// Ported verbatim from mango-mobile's own src/components/BottomSheet.tsx
// — a real, gesture-dismissible bottom sheet (swipe down or tap the
// backdrop to close, slides up from the bottom edge) built entirely on
// React Native's own Animated + PanResponder, deliberately NOT on
// @gorhom/bottom-sheet or react-native-reanimated/-gesture-handler. This
// adds zero new native surface — Animated, PanResponder and Modal are
// all core RN APIs, and react-native-safe-area-context is already a real
// dependency of this app.

import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, Dimensions, Modal, PanResponder, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme, type Colors} from '../theme/ThemeContext';

const SCREEN_HEIGHT = Dimensions.get('window').height;
// How far (in px) a downward drag/swipe must travel — or how fast it
// must be moving on release — before it counts as "dismiss" rather
// than "snap back open". Matches the feel of native bottom sheets
// (iOS share sheet, Android bottom sheet dialogs): a small nudge snaps
// back, a real swipe dismisses.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.8;

export function BottomSheet({
  visible,
  onClose,
  children,
  maxHeight,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional cap so a short sheet (e.g. a 3-row picker) doesn't stretch to fill the screen — defaults to 85% of screen height. */
  maxHeight?: number;
}) {
  const {colors} = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(SCREEN_HEIGHT);
      Animated.parallel([
        Animated.spring(translateY, {toValue: 0, useNativeDriver: true, bounciness: 4}),
        Animated.timing(backdropOpacity, {toValue: 1, duration: 200, useNativeDriver: true}),
      ]).start();
    }
    // Closing animates via handleClose below (so a gesture-driven close
    // and a programmatic visible=false both end up in the same place)
    // — this effect only ever drives the OPEN transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function animateClosed(onDone: () => void) {
    Animated.parallel([
      Animated.timing(translateY, {toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true}),
      Animated.timing(backdropOpacity, {toValue: 0, duration: 200, useNativeDriver: true}),
    ]).start(onDone);
  }

  function handleClose() {
    animateClosed(onClose);
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          translateY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
          handleClose();
        } else {
          Animated.spring(translateY, {toValue: 0, useNativeDriver: true, bounciness: 4}).start();
        }
      },
    }),
  ).current;

  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, {opacity: backdropOpacity}]}>
          <View style={StyleSheet.absoluteFill} onTouchEnd={handleClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight: maxHeight ?? SCREEN_HEIGHT * 0.85,
              // Modal renders as its own top-level native view hierarchy
              // — the static base padding below assumed a plain screen
              // edge and never accounted for a device's bottom gesture
              // bar/home indicator, which sits on top of that padding
              // rather than being additional space beneath it.
              paddingBottom: 28 + insets.bottom,
              transform: [{translateY}],
            },
          ]}>
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    overlay: {flex: 1, justifyContent: 'flex-end'},
    backdrop: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)'},
    sheet: {
      backgroundColor: colors.panel,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderColor: colors.panelBorder,
      borderWidth: 1,
      borderBottomWidth: 0,
      paddingHorizontal: 20,
      // paddingBottom is set inline above (28 + the device's bottom
      // safe-area inset) — not here, since this static value has no
      // access to that inset.
    },
    handleArea: {alignItems: 'center', paddingVertical: 10},
    handle: {width: 36, height: 4, borderRadius: 2, backgroundColor: colors.panelBorder},
  });
}
