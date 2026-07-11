---
name: Tab-bar-aware bottom padding
description: Convention for keeping scrollable content clear of the absolutely-positioned bottom tab bar in the mobile app
---

The mobile app's bottom tab bar is absolutely positioned, so it overlays screen content.

**Rule:** every screen that shows the tab bar must pad its scroll content (or pinned footer) with `tabBarHeight + insets.bottom + N`, where `tabBarHeight` comes from `useBottomTabBarHeight()` (`@react-navigation/bottom-tabs`).

**Why:** plain `insets.bottom + N` leaves the last rows/CTAs hidden under the tab bar — this was a user-reported bug across many screens (Billing & Plan etc.).

**How to apply:**
- New scrollable screens under the tabs layout: use the convention above.
- Exceptions that are correct with `insets.bottom` only: routes that hide the tab bar (conversation thread, enquiry form), bottom sheets inside a `Modal` (render above the tab bar), and screens already using large constants (+100 / +84+20) that exceed tab bar height.
- Files with multiple components: the hook must be declared in the SAME component that references `tabBarHeight` — a scripted insert after the first `useSafeAreaInsets()` match once missed the second component and broke typecheck.
