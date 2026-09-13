---
name: Search radius & geocoding
description: How customer search combines trusted bases with explicit service coverage, plus geocoding and cache semantics
---

- With a typed location and resolved active radius, public eligibility is `(trusted base is in radius) OR (declared serviceAreas has a case-insensitive location match)`. No profile-text inference; configured coverage is authoritative. Recommended ranks local-base matches before service-area-only matches; explicit sorts remain unchanged.
- Trader coordinates are SWEEP-OWNED (scheduler + postcodes.io bulk lookups of the base postcode). Trusted iff `geocodedPostcode === postcode`; a postcode edit on ANY route auto-requeues the row — deliberately NO write-path hooks (postcode writes are scattered across onboarding/profile/admin/change-requests; hook-hunting is the known duplicated-rule trap). `geocodedPostcode` set with null coords = definitive not-found; no retry until the postcode changes.
- geocode_cache (customer `near` anchors): negative rows ONLY for definitive 404s; transient network failures are never cached and never mark trader rows. In-memory Map (cap ~500) in front; `clearGeocodeMemoryCache()` is the test seam.
- Anchor precedence server-side: explicit lat/lng > geocoded `near` string > skip the base-radius branch (never a misleading empty list). An explicit service-area match still applies; without one the query degrades to UK-wide. Traders without trusted coords need explicit coverage while a radius is active.
- Per-card distance: `distanceMiles` on the public trader list is DISPLAY-ONLY, computed from the SAME shared haversine + trusted-coords SQL fragments as the filter (CASE → NULL for untrusted coords, so a stale row can never leak a number). The app sends the anchor even on UK-wide searches so distances still show; `radiusMiles` alone controls filtering. No anchor → null everywhere → cards hide the label.
- Mobile: `SearchRadius = number | null` (null = UK-wide); options list + labels live in ONE constants file — add future options there only. Committed value in SearchRadiusContext (AsyncStorage `search_radius_miles`, validated on load) because the Search tab stays mounted; the Search filter sheet edits a draft. Reset restores the 20-mile default and never touches location. Anchor from the app: location text box wins (`near=`), else device GPS coords, else nothing.
- **Prod deploy ordering:** the schema (latitude/longitude/geocoded_postcode + geocode_cache) MUST be pushed to the production DB before/with the new server build — drizzle selects whole rows, so missing columns break EVERY trader query, not just radius ones. After that the boot sweep backfills coords automatically; old servers safely ignore the new query params.
- **Why postcodes.io:** UK-only marketplace; free, keyless, official Open Government data; bulk endpoint (≤100) for the sweep.

**Why:** Traders can legitimately serve a customer town while operating from a
different base. The marketplace must honour deliberate coverage choices without
silently widening every profile to nationwide.

**How to apply:** Keep service coverage as trader-configured values from the
profile flow. If future coverage gains postcodes, polygons, or nationwide
settings, add each as an explicit authoritative branch with matching tests;
never derive it from prose.
