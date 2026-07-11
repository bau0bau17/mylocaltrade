---
name: Document expiry admin surfaces
description: Rules for what counts as an "expiring/expired" document in admin views and how manual expiry edits propagate.
---

**Rule:** A document stops needing expiry attention once a NEWER document of the same user+type is APPROVED and not itself expired. This "superseded" predicate must be applied consistently to every admin surface that counts or lists expiring documents (attention counts, dashboard, expiring-documents console) — they are separate queries, so a change in one must be mirrored in the others.

**Why:** Admin saw an expired insurance doc still flagged after approving its replacement; each surface computes its own count, so fixing only the list view leaves stale badge counts.

**How to apply:** Use the shared SQL fragment in the admin routes rather than re-deriving the predicate. Doc-level status "EXPIRED" is effectively unused — expiry is date-based (isDocExpired), so admin expiry edits only change `expiresAt` and then call `reconcileDocumentsState(userId)` to flip trader status immediately; the scheduler sweep handles the natural passage of time.

**Date input:** Manual expiry accepts YYYY-MM-DD stored as end-of-day UTC; validate with a component round-trip (reject 2026-02-30-style dates — JS Date silently normalises them).
