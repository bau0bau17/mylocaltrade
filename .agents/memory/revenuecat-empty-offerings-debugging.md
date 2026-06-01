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

## Test Store variant — "no Test Store products registered" with a test_ key
Different cause from the StoreKit one above. With a development build (__DEV__,
test_ key) the SDK reads the **RevenueCat Test Store**, not StoreKit. Error:
"configured with a Test Store API key, but there are no Test Store products
registered" == the served offerings response has zero packages.

**REAL ROOT CAUSE (verified): the offerings response the SDK consumes (v2 admin
API's edge-served config) is CACHED, and v2 writes to products / prices /
package-attachments / entitlement-attachments do NOT bust that cache. The dashboard
(v2 admin GET) shows everything correct while the SDK keeps getting empty packages.
The fix that regenerates the served config is to UPDATE THE OFFERING itself:**
`updateOffering({ ..., body: { display_name: <same value> } })` — a no-op touch is
enough. Immediately after, packages appear. **Why:** RevenueCat rebuilds the
offering's served payload on offering mutation, not on child-entity mutation.
**How to apply:** after ANY scripted change to test-store products/prices/package
links, always call updateOffering once to force a rebuild, then re-check.

**Diagnose without the user's device — replicate the exact SDK fetch** with the
public test_ key (it is a publishable client key, fine to use read-only):
`GET https://api.revenuecat.com/v1/subscribers/{anyAnonId}/offerings`
headers `Authorization: Bearer test_...`, `X-Platform: ios`, `X-Version: 8.0.0`.
Response `offerings[0].packages` is EXACTLY what `getOfferings()` returns on
device. `packages: []` here == currentPackageCount 0 on device. Use a fresh random
anon id per call (the CONFIG cache is per-app, not per-user, so new ids don't bust
it — only updateOffering does).

Things that turned out NOT to be the cause (ruled out by experiment): missing
product `title` (a create-only test-store field; absent on manually-made products
yet they still serve fine once the offering is touched), missing entitlement
attachment, GBP-vs-USD price, X-Platform/X-Version header values.

**Verify attachments via `GET /projects/{pid}/packages/{package_id}/products`** —
NOT `GET /offerings/{oid}/packages/{package_id}` (returns no product list, looks
falsely empty).

**Test store prices API is POST-only, upsert-per-currency.** PUT/DELETE on
`/products/{id}/test_store_prices` return 405; no per-currency delete exists. POST
a new currency ADDS it (does not replace); POSTing an existing currency errors
resource_already_exists. Can't remove a leftover currency via API — force the
displayed one by setting the iOS Simulator region (Settings → General → Language
& Region → United Kingdom) so the Test Store picks GBP.
