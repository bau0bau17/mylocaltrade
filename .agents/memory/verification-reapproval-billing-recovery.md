---
name: Verification reapproval billing recovery
description: How a trader verification reset/reapproval safely recovers an existing RevenueCat-backed Team subscription.
---

A verification reset does not revoke billing ownership. Once an administrator returns a trader to VERIFIED, perform best-effort entitlement reconciliation using only the canonical server-issued RevenueCat identity. Notify a mounted client to refresh only after that reconciliation has converged; an ordinary verification notification may still be sent when the provider is unavailable, but it must not trigger a premature client recovery.

**Why:** During the reset window the normal verified-only reconciliation guard correctly rejects sync. A client refresh before reapproval-side reconciliation can preserve the old warning rather than recover the entitlement. Repeated confirmations must also not fabricate new subscription starts or duplicate activation audits/notifications.

**How to apply:** Keep the VERIFIED authorization gate and fail-closed product resolution. Treat provider outages as non-fatal to verification approval, retain a manual retry path, and clear client warnings only after backend confirmation plus refreshed server-owned Team data.