import React from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
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
 * Cross-platform pinch-to-zoom + pan image viewer. Uses
 * react-native-gesture-handler v2 + reanimated v4 so it works on iOS,
 * Android, and react-native-web (the canvas iframe). Double-tap toggles
 * between fit-to-screen and 2.5x zoom.
 *
 * Note: gestures only work when the parent tree is wrapped in
 * <GestureHandlerRootView> — the app already does this in app/_layout.tsx.
 */
export default function PinchZoomImage({ source, onError, maxScale = 6, minScale = 1 }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(next, minScale * 0.8), maxScale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < minScale) {
        runOnJS(reset)();
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      // Only allow panning when zoomed in, so a single-finger swipe at
      // 1x doesn't fight with the modal/scroll.
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        runOnJS(reset)();
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
    <GestureDetector gesture={composed}>
      <View style={styles.container} collapsable={false}>
        <Animated.View style={[styles.inner, animatedStyle]}>
          <Image source={source} style={styles.image} resizeMode="contain" onError={onError} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  inner: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
