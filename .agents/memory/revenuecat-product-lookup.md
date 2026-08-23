---
name: RevenueCat product lookup
description: How to safely determine the Store product behind an active RevenueCat entitlement.
---

RevenueCat v2's active-entitlements endpoint establishes entitlement presence and expiry but does not include the Store product identifier. Determine an active plan by reading subscriptions, selecting the one with `gives_access: true`, then resolving its product resource through the product endpoint before comparing Store IDs.

**Why:** Treating the API resource ID or a historical product list as a Store identifier can produce a false product mismatch. A customer may have several expired subscriptions.

**How to apply:** For read-only production diagnosis, keep the canonical customer ID internal and return only the active boolean, product identifier, renewal/period state, and match result. Do not expose customer IDs, transaction identifiers, receipts, or credentials.