---
name: Pending-deletion auth contract (403, not 401)
description: Cancellable deletion states answer 403 ACCOUNT_DELETION_PENDING on normal routes; /auth/me + status/cancel stay reachable; cancel is a CAS.
---

The rule: users in a cancellable deletion state (REQUESTED / DISABLED_PENDING_RETENTION) get **403 `ACCOUNT_DELETION_PENDING`** from normal authMiddleware routes — deliberately NOT 401, because the mobile client treats 401 as a dead session and forceLogout would strip the very token needed to cancel. `/auth/me`, `/account/deletion-status` and `/account/deletion-cancel` use `authMiddlewareAllowDeletion` and stay reachable (auth/me returns `deletionStatus` so the app routes to the pending screen). Terminal states (ANONYMISED/COMPLETED/deletedAt) are plain 401 everywhere.

Cancel is a **conditional transition** (CAS): the UPDATE clears deletion fields only `WHERE deletionStatus IN (REQUESTED, DISABLED_PENDING_RETENTION)` with RETURNING; loser → 409 NOT_CANCELLABLE, and profile restore (traderProfiles.isActive=true) + audit + email are winner-only. **Why:** an admin can anonymise/complete between the route's pre-read and its write — an unconditional cancel would resurrect a terminal (PII-wiped) account.

**How to apply:** any new "locked account" state must decide 401-vs-403 by whether the user still needs the token for a self-service exit path; never make destructive/restorative lifecycle writes on a pre-read — always CAS on the states you expect.
