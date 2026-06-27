---
name: Subscription downgrade source of truth
description: When/where an expired RevenueCat (non-Stripe) subscription may be downgraded, and why the read path must not mutate.
---

# Subscription expiry / downgrade rules (api-server subscriptions route)

The `subscriptions` row can lag reality because downgrades historically depended
ONLY on the RevenueCat `EXPIRATION` webhook, which is unreliable in the Apple
Test Store / sandbox. Symptom: in-app Billing shows "Premium / Active / renews
<past date>" while Apple shows Expired and Restore finds nothing.

## Rules
- **Read path (`GET /subscriptions/status`) only REPORTS effective state, never
  mutates.** For a non-Stripe row whose `currentPeriodEnd <= now`, report
  plan=basic/null and status="expired" so the UI never shows stale Premium — but
  do NOT write.
  - **Why:** revoking perks on the date alone can falsely downgrade a sub that is
    still active during an Apple billing-grace window whose extended expiry we
    just haven't re-synced. A destructive write must be provider-confirmed.
- **Destructive downgrade is provider-confirmed only**, via two paths that must
  stay behaviourally identical (revoke perks: users.plan=null,
  trader_profiles.plan=null + isFeatured=false, subscriptions.status='cancelled'):
  1. `POST /subscriptions/revenuecat-sync` when RevenueCat reports no active
     entitlement (app calls it on focus and on "Restore purchases").
  2. `EXPIRATION` / `SUBSCRIPTION_PAUSED` webhook.
- **Stripe-owned rows (have stripeSubscriptionId or stripeCustomerId) must NEVER
  be mutated by any RevenueCat path** — Stripe webhooks are their source of truth.
  Every RC downgrade trigger checks this before writing.
- The shared revoke helper is for non-Stripe rows only.

## How to apply
- This is a backend-only correctness model: a stale Premium label and a lapsed
  sub heal without any new mobile build, because the app already hits these
  endpoints. Keep the read path side-effect-free; add new downgrade logic only to
  the provider-confirmed paths.
