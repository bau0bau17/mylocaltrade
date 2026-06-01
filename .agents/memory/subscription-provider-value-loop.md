---
name: SubscriptionProvider value loop
description: Why depending on the whole useSubscription() context object in effect deps causes an infinite render loop, and how to avoid it.
---

# SubscriptionProvider value loop

The mobile RevenueCat `SubscriptionProvider` rebuilds its context `value` object
on every render (it is not memoized). Any consumer that puts the whole
`subscription` object into `useEffect`/`useFocusEffect`/`useCallback`
dependencies will re-run that effect on every render. If the effect calls
`subscription.refresh()` (or anything that sets provider state), it triggers a
re-render, a new `value` object, and the effect fires again — "Maximum update
depth exceeded". LogBox usually points at `setCustomerInfo` because that is the
setter caught in the cycle, but the bug is the dependency, not the setter.

**Why:** RevenueCat's `getCustomerInfo()/purchase()/restore()` return a brand new
CustomerInfo object every call (requestDate changes each time), so even an
identical refresh re-renders subscribers; combined with an unstable dep object
this compounds into an infinite loop.

**How to apply:**
- In consumers, depend on the stable destructured members
  (`const { refresh, isSupported } = subscription;` then deps `[refresh, isSupported]`),
  never the whole `subscription` object. `refresh` is a stable `useCallback` that
  only rotates on auth-token change; `isSupported` is a module constant.
- Defensive backstop in `lib/revenuecat.tsx`: `applyCustomerInfo` skips
  `setCustomerInfo` when a stable `customerInfoSignature` (active entitlements,
  active subscriptions, purchased product ids, management URL) is unchanged.
- Optional future hardening: wrap the context `value` in `useMemo` so accidental
  whole-object deps stop being a footgun.
