import React from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  source: ImageSourcePropType;
  onError?: () => void;
  /** Maximum zoom level. Defaults to 6. */
  maxScale?: number;
  /** Minimum zoom level. Defaults to 1 (cannot zoom out below the fitted size). */
  minScale?: number;
}

/**
 * Cross-platform pinch-to-zoom + pan image viewer.
 *
 * Wraps its own GestureHandlerRootView so it works inside <Modal> on
 * react-native-web (Modal renders through a portal that lives outside the
 * app-level root) as well as on iOS/Android.
 *
 * All gesture callbacks are worklets that only mutate shared values — no
 * runOnJS round-trips, which avoids reanimated v4 footguns.
 */
export default function PinchZoomImage({ source, onError, maxScale = 6, minScale = 1 }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      const next = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(next, minScale * 0.6), maxScale);
    })
    .onEnd(() => {
      'worklet';
      if (scale.value < minScale) {
        scale.value = withTiming(minScale);
        savedScale.value = minScale;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      'worklet';
      // Only allow panning when zoomed in, otherwise a single-finger swipe
      // at fit-size could feel laggy and conflict with the modal scroll.
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      'worklet';
      if (scale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureHandlerRootView style={styles.root}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.inner, animatedStyle]} collapsable={false}>
          <Image source={source} style={styles.image} resizeMode="contain" onError={onError} />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', overflow: 'hidden' },
  inner: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
