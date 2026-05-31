---
name: expo-router NativeTabs breaks hidden-trigger navigation
description: Why native iOS builds open but inner screens (login/legal/pricing) won't navigate
---

`expo-router/unstable-native-tabs` (`NativeTabs`) renders the primary tabs
natively, but `router.push` to routes registered as **hidden** `NativeTabs.Trigger`
entries silently fails — the tap does nothing and the screen never opens.

**Symptom:** native iOS build launches, the 4 main tabs switch, but every inner
screen reached via router.push (login, legal-support, pricing/subscription,
contact-support, trader-dashboard, etc.) is dead. Web and Expo Go work because
they fall back to the classic JS `Tabs` layout.

**Trigger condition:** the tab layout selected `NativeTabs` when
`!isExpoGo && isLiquidGlassAvailable()` — true on real iOS 26 devices. So the
bug only appears in native builds on iOS 26, not in dev web preview.

**Fix:** force the classic JS `Tabs` layout (BlurView tab bar on iOS) instead of
NativeTabs while inner routes are modeled as hidden tab triggers. Don't gate the
NativeTabs branch only on Expo Go — a real native build hits it too.

**How to apply:** if a native Expo build opens but inner-route navigation is
dead while web works, check the (tabs) layout for an unstable-native-tabs branch
gated on isLiquidGlassAvailable(); hidden-trigger pushes are the trap.
