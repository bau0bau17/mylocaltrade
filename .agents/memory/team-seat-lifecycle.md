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

## Effective entitlement request barrier
- With Company Teams enabled, employee job reads and writes must check both a persisted seat suspension and the owner's current effective seat allowance. A zero allowance restricts the employee immediately, even before reconciliation writes a suspension row; owners remain supervisory.
- **Why:** a provider-confirmed Team-to-Solo transition can arrive just before the best-effort reconciliation or hourly retry. Relying only on the persisted row leaves a short period where employees can still access company job data.
- **How to apply:** use the shared job-access gate for conversation detail/list/count, enquiries, booking availability, and job mutations. Evaluate the effective subscription record only; a pending store product change is not an effective downgrade. Keep memberships intact and let reconciliation persist/reverse SYSTEM suspension in its canonical order.

## Privacy after access loss
- The effective-entitlement barrier applies to delivery and retention as well as requests: restricted employees receive no job notification payload, and client cache clearing must evict every company job query (conversations, enquiries, and their counts) before a restricted screen can render.
- **Why:** a seat can become ineffective before persisted reconciliation, while memberships remain ACTIVE. Filtering only reads/writes leaves customer data exposed through notification previews or already-mounted cached lead lists.
- **How to apply:** notification recipient resolution always retains the owner but filters employees by active, unsuspended membership and current effective allowance. On a restricted Team context, disable protected fetches and render the restricted state rather than stale data; retain only the context query that provides the authorization decision.

## RevenueCat webhook ordering
- Guard order: event-id dedupe (ledger insert in the mutation tx) → timestamp guard. Timestamp guard: skip if ts < lastProviderEventAtMs, **and at an exact tie only a revoke applies** (tied grant skipped). Both delivery orders of a tied grant+revoke converge on revoked; device sync self-heals a genuinely active entitlement.
- **Why:** arrival order must never pick subscription state (architect-review finding).
- Known limitation (accepted, documented in rollout doc): RC identity is the client-asserted numeric app_user_id; proper fix = server-bound opaque RC ids (needs mobile build + RC change).

## Drizzle unique-violation detection
- Drizzle wraps pg errors: 23505 may live in `err.cause.code`, not `err.code`. Check both or duplicate-key handling returns 500 instead of 409.
