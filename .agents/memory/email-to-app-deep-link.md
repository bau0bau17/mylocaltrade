---
name: Email/web to native app deep links without a new build
description: How to make an email or web link open the installed app, and when a new build is unavoidable
---

# Email/web → native app deep links

To make an email CTA (or any web link) open the installed app **without shipping
a new build**, link to a web redirect page that bounces to the app's existing
**custom scheme**, with a visible fallback for users who don't have the app.

**Why:** the app already registers its custom scheme at build time (app.json
`scheme`), so the installed build responds to `scheme://path` immediately — no
native config change, no rebuild. The mobile artifact owns the web root (`/`),
so its `server/serve.js` is the natural place to host the redirect route. The
page auto-navigates via JS to the scheme URL and shows a manual button +
fallback link.

**How to apply:**
- Backend/email builds the link as a normal https URL to the redirect route
  (carrying an id as a validated query param), NOT the raw scheme (email clients
  strip/deny custom-scheme hrefs).
- The redirect route must validate/sanitise the id (e.g. digits-only) before
  interpolating it into the scheme URL and the HTML, to avoid injection.
- Map the scheme path to an existing app route (groups like `(tabs)` are not
  part of the URL, so `app/(tabs)/messages/[id].tsx` is reached at
  `scheme://messages/<id>`).

**When a new build IS unavoidable:** a fully seamless open with **no Safari
hop** requires iOS **universal links** — `associatedDomains` in the native
config plus an apple-app-site-association file hosted at the domain. Both are
native/build-time, so they cannot be delivered by a backend/template change.

**Related project reality:** many TestFlight-reported bugs are already fixed in
the current code — the tester is simply on an older build. Always diff the
reported behaviour against current source before re-implementing; the fix may
just be "cut a new build".
