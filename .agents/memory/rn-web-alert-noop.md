---
name: RN Web Alert.alert buttons are a no-op
description: Why actions gated behind Alert.alert confirm dialogs silently fail on Expo web, and the fix
---

# Alert.alert action buttons do nothing on Expo web

On React Native Web (what the Replit canvas/preview iframe runs for the Expo
app), `Alert.alert(title, message, [buttons])` does **not** invoke the button
`onPress` callbacks. A single-message alert may or may not show, but any action
gated behind a confirm button (Cancel / Confirm) **never runs on web**.

**Symptom:** a button (e.g. "Accept offer & hire") appears to do nothing — no
network request fires — yet works fine on a native device. Diagnose by checking
the api-server logs: the expected POST simply never arrives.

**Fix:** never gate an action behind `Alert.alert` callbacks for cross-platform
code. Use the helper `artifacts/mobile/lib/confirm.ts` (`confirmAction`), which
falls back to `window.confirm` on web and uses native `Alert.alert` on
iOS/Android. Applied to the conversation lifecycle confirms (accept / complete /
close) in `app/(tabs)/messages/[id].tsx`.

**Note:** single-button info `Alert.alert("title","msg")` success/error toasts
are also unreliable on web — prefer a cross-platform notice if it must be seen.
