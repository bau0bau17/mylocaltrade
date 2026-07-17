---
name: Admin portal identity space
description: Admin-portal accounts are a separate identity space from app accounts in the shared users table
---

Admin-portal accounts (role "admin") and app accounts (customer/trader) share the users table but are separate identity spaces: the same email may exist once in each.

**Rules:**
- Email uniqueness is per-space via two partial unique indexes (`role <> 'admin'` / `role = 'admin'`), exact-case (legacy case-variant duplicates forbid a lower(email) index). There is NO global unique(email) any more.
- Every email lookup must be kind-scoped ("app" | "admin"). App auth flows (login without flag, resend-verification, verify-email-code, registrations) are hard-scoped to "app"; the admin web console sends `portal: "admin"` in login/forgot/reset bodies (raw body field, outside the codegen'd zod schema).
- Never convert rows between spaces: adding an admin CREATES a new admin row; removing admin access DEACTIVATES (isActive=false) — never delete (audit FKs) and never turn into a customer (would collide with a real app account on the same email).
- Login must reject `role='admin' && !isActive` at the boundary (mirrors loadActiveUser); for non-admin roles isActive is subscription/onboarding state and login stays allowed.
- Bootstrap prefers the admin-space row, falls back to promoting an app row only for first-ever boot.

**Why:** owner needs the same email as both an app user and a portal admin, and admin logins must never work in the mobile app.
