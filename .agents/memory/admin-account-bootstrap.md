---
name: Admin account creation (no signup path)
description: How admins are created in this app and why the first production admin needs a secret-driven startup bootstrap.
---

# Admins are promoted, never self-registered

There is no "register as admin" path. Public signup always creates `customer`
(or `trader`). An admin is just a `users` row with `role='admin'`, and admin
login additionally requires `isActive=true` (auth's loadActiveUser returns null
for an admin when `!isActive`; for customer/trader `isActive` is benign — a
verified customer is set active on email verification, traders stay inactive
until further onboarding).

## First production admin
The production database is separate from dev and not directly writable from the
agent (read-only replica), and there's no in-app promote endpoint that works
without an existing admin. So the first prod admin is created by a **secret-gated
startup bootstrap**: set `ADMIN_BOOTSTRAP_EMAIL`, the boot hook promotes that one
already-signed-up + email-verified + active + non-deleted user to admin.

**Why:** chicken-and-egg (every admin route is `adminOnly`) + read-only prod DB.

**How to apply:** keep it promotion-only (never create/demote/re-enable — guard
on isActive rather than force-setting it), single-email, no HTTP surface,
idempotent, and fully disabled when the secret is unset. Remove the secret after
the admin exists. Flow: sign up in prod → verify email → set secret → redeploy →
promoted → log into admin web.
