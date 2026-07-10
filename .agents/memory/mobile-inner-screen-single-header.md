---
name: Mobile inner-screen single-header rule
description: How headers/titles/top-padding must work on Expo (tabs) inner routes to avoid duplicate headers and empty top gaps.
---

# Inner (tabs) routes get ONE shared header — screens must not render their own

Every inner route listed in `app/(tabs)/_layout.tsx` INNER_ROUTES receives a single
shared `ScreenHeader` (stack variant, with the back button) rendered by the Tabs
`header` option. Individual inner screens must therefore:

- NOT render their own local header bar (back button + title) inside page content.
- NOT render an in-page H1 that merely repeats the route title (e.g. header
  "Privacy Policy" + big "Privacy Policy" heading). A *distinct* branded/contextual
  hero is fine ("Welcome Back", "Choose Your Plan", "Contact <trader>"); an exact or
  near-exact one-to-one repeat of the route title is a duplicate — remove or reword it.
- NOT add `insets.top` to the top-level content container's `paddingTop`. The shared
  header already consumes the safe area, so `paddingTop: insets.top + N` double-counts
  and produces a visible empty gap under the header. Use a small constant (~12–16).
  `insets.top` is still correct in transient centered loading/error/guard states that
  render *without* the shared header.

**Why:** users reported two stacked headers + dead top space on Business Profile and
across many screens; the layout applies the header globally so screens re-adding one
duplicate it.

**How to apply:** when auditing, sweep both `paddingTop: insets.top` on top-level
containers AND `<Text style={styles.title}>` headings, then compare each heading to
its INNER_ROUTES `title`.

## Exception: conversation screen (messages/[id])
It owns a rich functional header card (name, status pills, actions) and no OS back
button, so it HIDES the shared header via a `hideHeader` flag in `_layout.tsx`
(`headerShown: !hideHeader`) and becomes the single header itself: card gets
`paddingTop: insets.top + 8`, its own chevron-left back button, and
`keyboardVerticalOffset={0}` (0 because, with the shared header gone, the
KeyboardAvoidingView now starts at the very top). Because inner routes are hidden Tabs
screens, its back/loading/error affordances all use one `goBack` helper =
`router.replace(returnTo ?? "/messages")`, never `router.back()` (which lands on the
wrong tab — see tabs-back-navigation.md).
