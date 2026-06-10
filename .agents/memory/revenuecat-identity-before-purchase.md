---
name: RevenueCat identity must be set before purchase
description: Why purchases must logIn(appUserId) before purchasePackage, or they orphan on an anonymous RC id.
---

RevenueCat is configured anonymously (`configure({ apiKey })` with no appUserID). If a purchase/restore runs before the device is identified, it lands on a `$RCAnonymousID:...` customer. Both server paths key on our numeric app user id — the sync endpoint queries RC v2 with `customer_id=String(userId)`, and the webhook maps `app_user_id` to a user — so an anonymous purchase is invisible to both and the entitlement is orphaned.

**Why:** Configuring anonymously then calling `logIn(userId)` in a `useEffect` on user-change races the purchase button. A device can still be anonymous when the user taps buy.

**How to apply:** Before `purchasePackage`/`restorePurchases`, await an identity check: `getAppUserID()`, and if it !== `String(user.id)` call `logIn(String(user.id))` and await it. Throw (do not proceed) if there's no signed-in user, so you never make an unattributable purchase. The Customer Center "User ID" showing `$RCAnonymousID` is the tell that identity never took effect.
