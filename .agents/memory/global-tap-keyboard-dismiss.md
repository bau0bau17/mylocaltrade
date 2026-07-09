---
name: Global tap-to-dismiss keyboard
description: Why the app-wide keyboard dismissal must stay a passive touch observer, never a root Touchable wrapper.
---

Rule: implement app-wide "tap outside an input closes the keyboard" with passive `onTouchStart`/`onTouchEnd` on the root View (tap = movement ≤ ~10px; skip when the tap target tag equals the focused TextInput's tag; fail-safe to NOT dismiss when tags can't be determined).

**Why:** wrapping the root layout in `TouchableWithoutFeedback onPress={Keyboard.dismiss}` broke scrolling on real iPhones (e.g. document-upload screen stopped scrolling after a tap) — a root touchable enters responder negotiation and conflicts with ScrollView/gesture-handler. Passive touch props only observe bubbling touches and never claim the gesture.

**How to apply:** keep the logic in the root layout hook; do not re-add per-screen `TouchableWithoutFeedback` dismissal wrappers, and never reintroduce a root-level Touchable/Pressable for this purpose. Track touch starts keyed by touch identifier (multi-touch safety).
