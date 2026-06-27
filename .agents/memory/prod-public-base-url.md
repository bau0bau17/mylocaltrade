---
name: Production public base URL for email links
description: Why outbound links (verify-email, confirm, unsubscribe) must derive the host from the deployment domain, not the dev-only env var.
---

# Email / outbound link host must use the deployment domain

When building absolute URLs that ship to users in email (verify-email,
business-email confirm, lead-reminder unsubscribe, hosted logo), resolve the
host in this order: `API_BASE_URL` (operator override) → `REPLIT_DOMAINS`
(first entry, the live deployment domain) → `REPLIT_DEV_DOMAIN` (dev container
only) → `http://localhost:8080` (last resort).

**Why:** `REPLIT_DEV_DOMAIN` is set in the dev container but is ABSENT in a
Replit deployment. Code that did `API_BASE_URL ?? REPLIT_DEV_DOMAIN ?? localhost`
therefore fell through to `localhost:8080` in production unless someone
remembered to set `API_BASE_URL` — making every "verify your email" link dead
for real users at launch. This is a silent, launch-day failure (no error, just
unclickable links).

**How to apply:** Any new outbound-link builder in api-server must include the
`REPLIT_DOMAINS` branch. Helper lives in `email.ts` (`getApiBaseUrl`); keep
`lead-reminders.ts` and any future copies consistent with the same precedence.
