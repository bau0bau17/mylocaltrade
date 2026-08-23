---
name: RevenueCat product lookup
description: How to safely determine the Store product behind an active RevenueCat entitlement.
---

RevenueCat v2's active-entitlements endpoint establishes entitlement presence and expiry but does not include the Store product identifier. The server SDK's `product_identifier` field can therefore be absent even while the entitlement is active. Determine an active plan by paginating the customer's subscriptions, requiring exactly one `active` + `gives_access` subscription linked to that entitlement, then resolving its product resource through the product endpoint before comparing Store IDs.

**Why:** Treating the API resource ID or a historical product list as a Store identifier can produce a false product mismatch. A customer may have several expired subscriptions, and an eligible subscription can appear after the first page.

**How to apply:** Follow RevenueCat `next_page` → `starting_after` cursors with a bounded, loop-safe traversal; zero or multiple eligible subscriptions, malformed pagination, or a product lookup failure must fail closed before persistence. For read-only production diagnosis, keep the canonical customer ID internal and return only the active boolean, product identifier, renewal/period state, and match result. Do not expose customer IDs, transaction identifiers, receipts, or credentials.