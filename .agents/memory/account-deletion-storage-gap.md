---
name: Account deletion storage cleanup (gap FIXED Aug 2026)
description: Storage-object cleanup for deleted accounts now runs via a durable account_cleanup_jobs outbox; rules for keeping it correct.
---

The old gap (soft delete left avatar/logo/gallery/verification files orphaned in the private bucket) is **FIXED** (Aug 2026 P0 hardening): finalisation (admin anonymise/complete) enqueues an `account_cleanup_jobs` outbox row **in the same transaction as the guarded status flip** (winner-only), fires an immediate best-effort run, and an hourly sweep retries non-DONE jobs and **backfills jobs for accounts finalised before the mechanism existed** (orphan-sweep via namespace listing).

Invariants to preserve:
- **Namespace containment**: `isValidCleanupPath` only ever deletes inside the owner's own `/objects/customer-uploads/<uid>/` or `/objects/trader-documents/<uid>/` (category-matched, no `..`). Foreign paths → state `invalid`, permanent skip + integrity log — never touched.
- **No false DONE**: a job reaches DONE only when every object is terminal (deleted/missing/invalid) **and both namespace listings succeeded that run**. A failed listing means incomplete inventory → stay PARTIAL with lastError (a transient listing outage must not strand unreferenced objects forever).
- ObjectNotFoundError = `missing` = success (idempotent retries, double-delete race harmless).
- **Single-flight sweep**: sweepAccountCleanupJobs takes `pg_try_advisory_xact_lock` (deployment is autoscale, every instance runs the scheduler); non-holders skip. Xact-level, so a crashed holder can never wedge the sweep.
- `trader_documents` rows are purged once their objects are deleted/missing; the review audit trail lives in `trader_audit_log`.
- Retention schedule + 30-day finalisation commitment documented in docs/data-retention.md; email + app copy say "within 30 days, unless a legal retention period applies".

**How to apply:** never delete storage inline in the finalisation transaction (enqueue instead); any new user-owned storage category must be added to the path inventory AND the namespace validator; tests mock ../lib/objectStorage wholesale (see account-cleanup.test.ts).

Related facts from the same inventory (durable):
- The RevenueCat connector's proxyFetch only accepts v2 API paths (`/v2/projects/...`); v1 `/v1/subscribers/...` returns 401.
- Admin identity space really is separate: an admin row sharing an email with an app-space account does not block app-space re-registration and is refused by the deletion flow.
