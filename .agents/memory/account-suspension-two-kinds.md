---
name: Two distinct suspension mechanisms
description: users.suspendedAt (account-level moderation block) vs trader verificationStatus SUSPENDED (public listing) — do not conflate
---

There are TWO independent "suspend" concepts:

1. **Trader verification suspension** — `trader_profiles.verificationStatus = 'SUSPENDED'` via `POST /admin/traders/:userId/suspend`. Controls public listing/visibility, sends email+push.
2. **Account-level moderation suspension** — `users.suspendedAt/suspendedReason/suspendedByAdminId` via `POST /admin/users/:userId/suspend`. Applies to any app user (customer or trader); blocks sending conversation messages and creating enquiries (403 code `ACCOUNT_SUSPENDED`). No email/push, audit actions `USER_SUSPENDED`/`USER_UNSUSPENDED`.

**Why:** repeat contact-bypass offenders needed an account-wide block from the moderation queue without touching trader public visibility (which is verification-driven — see trader-public-visibility).

**How to apply:** when gating a new user write path (quotes, offers, etc.), check `users.suspendedAt` and return the same 403 `ACCOUNT_SUSPENDED` shape. Check suspension AFTER participant authorization so outsiders can't probe account state. Never repurpose trader verification suspension for messaging blocks or vice versa. Note `users.isActive=false` only blocks admin logins, not app users — it's not a suspension mechanism.
