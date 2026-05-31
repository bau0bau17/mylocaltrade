---
name: GestureHandlerRootView must have flex:1
description: Why touches/navigation die in native release (EAS) builds but work in Expo Go/dev
---

`react-native-gesture-handler`'s `GestureHandlerRootView` MUST be given
`style={{ flex: 1 }}`. Without it, the view collapses and **all touch/press
handling inside it stops working in native release builds** (EAS preview/production),
even though the UI still renders and the app launches.

**Symptom:** app opens, shows screens, native prompts (location) work, but every
`onPress` / `router.push` is dead — login, legal, support, navigation all unresponsive.
Works fine in Expo Go / dev, fails only in release.

**Why:** in dev the missing flex is often masked; release layout/new-arch exposes it.

**How to apply:** any root `<GestureHandlerRootView>` in an Expo/RN app needs
`style={{ flex: 1 }}`. Check this first when a release build is non-interactive but
the API is healthy and screens render.
