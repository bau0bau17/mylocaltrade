---
name: Expo artifact owns the production web root
description: Why the deployed root URL showed an Expo Go / QR dev-preview page and how to keep it production-safe
---

# Expo artifact owns the production web root

In this multi-artifact deployment, routing is path-based and the **mobile (Expo)
artifact owns `/`** (previewPath `/`). Its production web server
(`artifacts/mobile/server/serve.js` + `server/templates/landing-page.html`)
ships, by scaffold default, an Expo Go developer-preview page ("Download Expo
Go / Scan QR / Open in Expo Go") that also serves Expo manifests
(`expo-platform` header) and JS bundles, and auto-redirects phones to
`exps://...`. That is what appears at the public deployment root — not the API.

**Invariant:** for an app distributed via TestFlight / App Store, the deployed
web root must NOT expose Expo Go, QR, `exps://` deep links, or Expo
manifests/bundles. serve.js should serve only a plain landing page + a
`/status` health probe and 404 everything else.

**Why it's safe to strip:** `app.json` has `updates: null` (no self-hosted OTA),
and native builds resolve the API via `EXPO_PUBLIC_API_URL` baked at EAS build
time — so nothing the native app needs is served from this web surface. The
Expo manifest/bundle serving exists purely for loading the JS into Expo Go
during development.

**How to apply:** keep the fix inside the mobile artifact's `server/` +
`scripts/build.js` (make build a no-op — no Metro web export needed just to host
a landing page). Do NOT change previewPaths / artifact.toml routing; `/api`
(api-server) and `/admin/` (admin web) own their own paths and must stay
untouched. Changes require a **republish** to take effect. Separately, the
`mockup-sandbox` design artifact (path `/__mockup`) has no production service and
returns 500 publicly — a dev tool that ideally shouldn't be routed in prod.
