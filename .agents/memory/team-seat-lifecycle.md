---
name: Team seat lifecycle (Phase D)
description: Seat suspension/reconciliation invariants, exemption expiry sweep, RC webhook ordering tie-break, and drizzle 23505 detection.
---

## Deterministic seat reconciliation
- Seats belong to the LONGEST-STANDING employees (createdAt ASC, id ASC). Over allowance → suspend NEWEST first (`seatSuspensionSource='SYSTEM'`); room returns → reactivate SYSTEM-suspended longest-standing first. OWNER-suspended is NEVER auto-reactivated.
- **Why:** documented+tested rule (docs/team-billing-rollout.md); changing ordering silently changes who loses access on downgrade.
- Suspension is metadata only — membership stays ACTIVE, nothing deleted. Owner never occupies a seat.
- Effective allowance = max(plan seats if sub active, live exemption) clamped to 20; unknown products fail closed to Solo.
- All seat-changing ops (invite create/resend/accept, owner suspend/reactivate, reconcile) take `pg_advisory_xact_lock(812004101, traderProfileId)` inside their tx.
- Write gate (403 SEAT_SUSPENDED at job-action choke points) is EMPLOYEE-only and **flag-independent**.

## Durable sweep is part of the contract
- Event-driven reconciliation alone has two holes: (1) time-bounded exemptions expire without any event firing; (2) post-commit reconciles after webhooks/admin actions are deliberately best-effort (billing ack must not fail). The hourly scheduler sweep (`sweepCompanySeatReconciliation`) is the retry/enforcement for both. Never remove it or make post-commit reconciles blocking instead.
- Don't call the real sweep in tests with flags on — shared dev DB means it reconciles OTHER test files' companies mid-run. Test via `reconcileCompanySeats` on one profile.

## RevenueCat webhook ordering
- Guard order: event-id dedupe (ledger insert in the mutation tx) → timestamp guard. Timestamp guard: skip if ts < lastProviderEventAtMs, **and at an exact tie only a revoke applies** (tied grant skipped). Both delivery orders of a tied grant+revoke converge on revoked; device sync self-heals a genuinely active entitlement.
- **Why:** arrival order must never pick subscription state (architect-review finding).
- Known limitation (accepted, documented in rollout doc): RC identity is the client-asserted numeric app_user_id; proper fix = server-bound opaque RC ids (needs mobile build + RC change).

## Drizzle unique-violation detection
- Drizzle wraps pg errors: 23505 may live in `err.cause.code`, not `err.code`. Check both or duplicate-key handling returns 500 instead of 409.
