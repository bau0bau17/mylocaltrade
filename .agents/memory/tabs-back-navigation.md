---
name: Back navigation on hidden-tab inner pages
description: Why back/swipe-back on inner pages must use the declared-parent mapping, never router.back() or native stack gestures.
---

Rule: inner pages live as HIDDEN Tabs screens (not stack pushes), so `router.back()`/native iOS swipe-back do not work for them. Back navigation (header button AND the custom left-edge swipe gesture) must go through the single INNER_ROUTES parent mapping (`returnTo` param wins over declared parent), via `router.replace`.

**Why:** tab switches leave no usable stack history — `router.back()` returns to the previously active tab (e.g. Home), not the page the user came from. The iOS swipe-back gesture only exists for native-stack pushes, so it had to be added manually (edge-confined RNGH pan, navigate on gesture END with distance/velocity gate — onStart triggering caused accidental backs).

**How to apply:** when adding a new inner page, register it in the INNER_ROUTES table with its parent — both the back button and the swipe gesture then work automatically. Never add per-screen back logic or a second mapping. Root-stack screens (e.g. trader/[id], admin/*) are real pushes and keep the native gesture — don't add the custom one there.
