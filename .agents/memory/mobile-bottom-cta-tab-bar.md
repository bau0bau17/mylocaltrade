---
name: Mobile bottom CTA hidden behind tab bar
description: Inner (tabs) routes have an absolutely-positioned bottom tab bar that covers in-scroll CTAs
---

The mobile app's `(tabs)/_layout.tsx` renders the four primary tabs AND many
"inner" routes (href: null) that inherit the SAME bottom tab bar. That tab bar
is **absolutely positioned** (blur overlay), so it floats on top of screen
content. A primary CTA placed at the end of a ScrollView (e.g. "Submit for
review" on `trader-dashboard/documents`) scrolls UNDER the tab bar and looks
cut off / untappable.

**Two fixes that work:**
- Pin the CTA OUTSIDE the ScrollView as a footer `View` with
  `paddingBottom: insets.bottom + useBottomTabBarHeight() + 12` so it sits above
  the tab bar and is always visible. (Used on the documents screen.)
- OR hide the tab bar on that route, like `messages/[id]` does via
  `tabBarStyle: { display: "none" }` in the layout's INNER_ROUTES loop. Do this
  when the screen owns its own bottom UI (chat composer, etc.).

**Why:** padding the ScrollView's contentContainer by tabBarHeight only clears
the bar when fully scrolled; mid-scroll the CTA still peeks behind it, and users
read that as "the button is broken / hidden."

**How to apply:** any bottom CTA on an inner (tabs) route must be a pinned
footer above the tab bar, not the last child of the ScrollView. Remember this
only reaches the user's phone after a NEW EAS build (preview bakes JS at build
time; no OTA configured) — a reload will NOT show the fix.
