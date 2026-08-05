---
name: Stripe is dormant, never-launched web billing
description: Whether Stripe paths are live, what still depends on them, and what the prod data/secrets actually show.
---

Stripe in this project is **planned-but-never-launched web billing**, not a live or formerly-live provider. Verified (Aug 2026): no STRIPE_* secrets exist in dev **or** production; production has zero Stripe residue (no `sub_`/`cus_` ids, no demo rows — all subscription rows are RevenueCat-owned with NULL stripe columns). Apple IAP via RevenueCat is the only billing path that has ever run in prod.

**Why it's inert:** every Stripe path fails closed — webhook 403s when STRIPE_WEBHOOK_SECRET is unset (before any parsing), checkout throws at Stripe client construction without STRIPE_SECRET_KEY, demo-activate is hard-blocked on NODE_ENV=production, cancel/resume only call Stripe when a row has a Stripe id (none do). No client (mobile/admin/landing) calls `/subscriptions/checkout` at all.

**How to apply:**
- Don't treat Stripe code as reachable when reasoning about prod behaviour or security severity; but also don't delete it casually — the DEV demo flow (checkout demo mode → demo-activate, admin PromoCodes page) rides the stripe columns with fake ids.
- The `stripeOwned` guards in revenuecat-sync protect hypothetical Stripe rows; with zero such rows they're vestigial but load-bearing for the dual-provider design while the code stays.
- If removal is ever approved: scope = real-mode checkout, /webhooks/stripe, Stripe calls in cancel/resume, `stripe` dep, stripeOwned guards; keep/rework demo mode; schema-column drop is a separate, optional step (all NULL in prod, so a publish-time drop is safe).
