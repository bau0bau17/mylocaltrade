---
name: RevenueCat Test Store is debug-only
description: The test_ Test Store API key fatally crashes Release builds; no standalone (no-Metro) Test Store build is possible
---

# RevenueCat Test Store key only works in Debug builds

RevenueCat's native SDK raises a **fatal error and crashes the app at `configure`**
(crash-loop on launch) if a Test Store key (`test_...`) is used in a **Release**
build configuration. Error: `[RevenueCat]: Test Store API key used in Release build`.

**Why:** RevenueCat enforces this by design (native Configuration.swift) so test
purchases/entitlements can never leak into production. It is NOT something an
app-side flag can override.

**How to apply:**
- Test Store (plans visible without App Store / Apple sandbox) works ONLY in a
  Debug build → the EAS `development` (dev-client) profile, which **requires
  Metro** running on the dev machine.
- There is **NO standalone / no-Metro build that uses the Test Store**. Any
  "release profile + test_ key" combo (e.g. a FORCE_TEST_STORE override) WILL
  crash-loop on launch. Do not attempt it again — this was tried and failed.
- For any standalone / internal-distribution / TestFlight release build you MUST
  use the platform key (`appl_` / `goog_`); plans then come from the real App
  Store / Apple sandbox (which needs a working sandbox storefront).
- Gate test-key selection on `__DEV__` only. `__DEV__` is false in every EAS
  release profile (preview/production/internal), so they correctly use `appl_`.
