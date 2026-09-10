---
name: RevenueCat product-change authority
description: How to handle Apple/RevenueCat product changes without premature access or Team-seat changes.
---

Treat a `PRODUCT_CHANGE` webhook as a signal to reconcile the provider's currently effective access-granting subscription, not as proof that the webhook's product identifier is already active. If that reconciliation is incomplete or has no active entitlement, preserve the locally confirmed entitlement and Team seats. Only explicit expiry/pause handling may remove access.

**Why:** Apple can schedule a downgrade for the next renewal. Treating its product-change event or a transient provider read as an immediate access change can revoke Team seats before the paid Team period has ended.

**How to apply:** Reconcile an effective product only through the authoritative active-entitlement/subscription path. Keep product-change reconciliation non-destructive on an empty provider response, and ensure any seat reconciliation follows a confirmed effective product.