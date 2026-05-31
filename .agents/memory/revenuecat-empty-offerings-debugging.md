---
name: RevenueCat empty offerings on iOS — find the real cause in storekitd
description: The RC "offerings empty" error is generic; the device StoreKit log holds the true blocker
---

When a native iOS build shows no monthly/annual packages and RevenueCat logs
"None of the products registered in the RevenueCat dashboard could be fetched
from App Store Connect" (https://rev.cat/why-are-offerings-empty), that RC
message is a GENERIC catch-all. Do NOT conclude it's Missing Metadata or a RC
dashboard misconfig from it alone.

**Find the real cause in the device `storekitd` / ACAccount logs (Console.app):**
- `ACAccount … source account has no storefront` + `storefront = (null)` →
  no working **sandbox Apple Account** signed in on the device. StoreKit can't
  pick an App Store catalog → fetches zero products. Fix on device:
  Settings → Developer → Sandbox Apple Account; sign in a Sandbox Tester that
  has an explicit Country/Region (use GB for this UK app). Recreate the tester
  if it was made without a region. `sandboxReceipt … no such file` alongside
  this is normal before any sandbox purchase.
- Only AFTER a valid storefront exists can you judge the next layer:
  product still "Missing Metadata" (not "Ready to Submit"), product not
  available in the tester's territory, Paid Apps agreement inactive, or RC
  packages attached as CUSTOM instead of MONTHLY/ANNUAL.

**Build/key context for this app:** preview EAS build runs with __DEV__=false,
so it uses the real iOS App Store key (appl_), querying real StoreKit/sandbox —
NOT the RevenueCat Test Store. The Test Store key is only used by the
development profile (__DEV__=true). Diagnostics logging in lib/revenuecat.tsx
is gated on the Test Store key being present (dev + preview, never production).

**How to apply:** triage order for empty iOS offerings = (1) device sandbox
storefront, (2) territory availability + product state, (3) RC package types /
current offering. Always read storekitd before blaming metadata.
