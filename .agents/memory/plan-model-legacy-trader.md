---
name: MyLocalTrade plan model and legacy "trader" rows
description: The Basic/Premium subscription model and how legacy plan values are handled
---

# MyLocalTrade subscription plan model

Two-tier model: `basic` (free, limited) and `premium` (single paid tier, sold as
Premium Monthly £9.99 and Premium Yearly £99.99 via RevenueCat/Stripe). There is
**no `elite` or `premium_plus`** — those were removed and folded into Premium.

**Why:** the product has a single paid tier; monthly vs yearly is an
interval/price difference, not a separate plan id. In the API `PLANS` fallback,
both premium cards share `id: "premium"` and differ only by `interval`/`price`.

## Legacy "trader" plan value
The live DB predates the unified ids and contains rows with `plan = "trader"`
for existing paid subscribers. RevenueCat sync now writes `"premium"` (was
`"trader"`), so these self-heal on the subscriber's next app open.

**How to apply:** until migration completes, treat any non-basic plan as Premium
rather than matching `=== "premium"` exactly. UI uses `plan && plan !== "basic"`
for badges/entitlements; the traders list filter uses
`inArray(plan, ["premium", "trader"])`. This keeps existing paid traders
discoverable and badged before they re-sync.

**Note:** plan columns are `varchar(20)`; the id change was values-only, no
migration.
