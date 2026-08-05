---
name: Stripe removed (Aug 2026) — legacy NULL columns only
description: Stripe web billing code was fully removed; what intentionally remains, and what must not be reintroduced.
---

Stripe here was **planned-but-never-launched web billing**; all Stripe code (checkout, webhook, cancel/resume API calls, provider guards, npm dep) was removed in Aug 2026. Apple IAP via RevenueCat is the only billing provider that has ever run in prod (verified pre-removal: no STRIPE_* secrets dev **or** prod; zero Stripe-owned rows).

**Why:** the dead code carried real maintenance/security surface (an unauthenticated webhook route, raw-body mount, provider guards) for a provider with no data, no secrets, and no client callers.

**What intentionally remains — do not "clean up" further without a decision:**
- Stripe id columns in the users/subscriptions schemas: documented legacy, always NULL; admin deletion/anonymisation still nulls them. Dropping them is a deliberate future migration (all NULL in prod, but the schema push must be coordinated with a deploy).
- Dev-only demo activation is a standalone endpoint gated per-request on NODE_ENV=production → 404; it never writes stripe columns. Promo codes apply only to this dev flow (App Store pricing can't be discounted by our codes).
- Cancel/resume endpoints kept for the mobile billing screen but are purely local record updates.

**How to apply:**
- Never reintroduce Stripe references in copy, config, provider enums, or deps. Billing provider value space is `apple` | `demo`.
- Treat any "add a stripeOwned guard back" impulse as wrong: RevenueCat paths are guard-free on purpose (grants keyed off existing-row status only).
