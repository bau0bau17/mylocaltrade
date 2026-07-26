---
name: Universal Links in email CTAs
description: Email /open deep links must use the associated domain host or iOS opens the browser first.
---

iOS Universal Links only bypass the browser when the link's host matches the app's `associatedDomains` (mylocaltrade.co.uk / www.mylocaltrade.co.uk, AASA served by the mobile artifact's serve.js at /.well-known/apple-app-site-association matching path `/open`).

- All email `/open?...` links go through `getOpenLinkBase()` in the API email lib: prefers `UNIVERSAL_LINK_BASE_URL` (validated against the associated hosts — invalid overrides are ignored with a warning), then an associated-domain entry in `REPLIT_DOMAINS`, then the API base fallback (custom-scheme bounce page still works, just with a browser hop).
- Brevo click-tracking can wrap hrefs in a tracking host, which also defeats Universal Links — if buttons still open the browser on TestFlight, check the Brevo account's link-tracking setting for transactional mail; it is not controllable per-message via the current API payload.
- Logged-out recovery: `/open` route stashes the destination in a module-level pending-deep-link helper and bounces to login; login consumes it after success. Not persisted on purpose (stale intents dropped on cold start).

**Why:** the "Open my leads" email button previously hopped through the browser because the link host was a replit.app domain.
**How to apply:** any new email deep link must use getOpenLinkBase() + `/open?...`, never getApiBaseUrl directly.
