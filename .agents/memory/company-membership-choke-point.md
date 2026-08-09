---
name: Company membership choke point
description: Company Teams access rules — the single membership resolver, the owner-only fail-closed-by-construction pattern, backfill semantics, and the flag-enable precondition.
---

# Company membership choke point (Company Teams)

**Rule 1 — one resolver.** `getActiveMembership(userId)` in the API server's lib is the ONLY place that answers "which trader business does this caller act for, and with what role?". Member-shared surfaces (conversations actor context, enquiries list/new-count, quotes profile resolution, bookings participant role, reviews list, reports trader branch, profile GET) all call it. Never reintroduce per-route `trader_profiles.user_id = callerUserId` lookups on shared surfaces.

- Flag OFF (`COMPANY_TEAMS_ENABLED` unset/false, the default): resolver is bit-identical to the legacy owned-profile lookup, role always OWNER.
- Flag ON: ACTIVE `company_members` row wins; owner-without-row falls back to owned profile (backfill safety); REVOKED/no row ⇒ null (fail closed).
- The resolver ENFORCES (not assumes) that an OWNER membership matches `trader_profiles.user_id`; forged/corrupt OWNER rows fail closed with an integrity-violation error log.

**Rule 2 — owner-only routes fail closed, via one of TWO patterns.** (a) Routes that resolve an owned `trader_profiles` row first (profile PUT, phone OTP, subscription mutations, review replies, profile-change requests, onboarding/legal) fail closed automatically: employees own no profile ⇒ existing 404/403. Do NOT "helpfully" swap these to the membership resolver — that would grant employees owner powers. (b) Routes keyed DIRECTLY by `users.id` with NO profile lookup do NOT fail closed — verification documents was this hole (an active or REVOKED employee, role=trader, could mint upload URLs and manage own doc rows with an existing session). Such surfaces need an explicit gate (see `documentsOwnerGate` in the documents router): owned profile ⇒ pass; else ANY `company_members` row of any status ⇒ 403 `OWNER_ONLY`; else (brand-new pre-onboarding trader, no company ties) ⇒ legacy pass. The gate is deliberately flag-INDEPENDENT so revoked employees stay locked out even if the flag is later turned off. When adding ANY owner surface, decide which pattern it is — `role=trader` never implies "owns a profile" once teams exist.

**Why:** one resolver keeps multi-member authorization auditable in a single file; the untouched owner-only routes mean flag-off behavior provably cannot drift and employees fail closed even if route code is forgotten.

**Backfill:** boot-time, idempotent (`ON CONFLICT DO NOTHING` — never resurrects revocations). Conversation `assigned_trader_user_id` mirroring from `trader_user_id` runs ONLY while the flag is off; once claiming ships, NULL = legitimately unclaimed. Errors are loud but non-fatal (owner fallback keeps businesses working).

**Flag precondition:** never enable `COMPANY_TEAMS_ENABLED` in production before job claiming/assignment enforcement ships — with the flag on, every ACTIVE member counts as trader participant of ALL company conversations (messages, quotes, bookings), which is only safe once claim rules exist.

**Seat cap:** invite create and expired-invite re-arm serialise the cap check + write inside a tx holding `pg_advisory_xact_lock(CAP_LOCK_NAMESPACE, traderProfileId)` — a plain count-then-insert lets two concurrent requests both see the last free seat. Invite tokens: raw 32B base64url only in the email link; SHA-256 hex stored; lookup/accept are POST-body (keeps tokens out of pino URL logs); all invalid states collapse to one generic response.

**How to apply:** any new trader-side route decides first: member-shared (use the resolver) or owner-only (owned-profile lookup, optionally + explicit owner gate). Tests that touch the flag must save/restore the external env value (single-fork vitest shares the process with the equivalence run `COMPANY_TEAMS_ENABLED=true`).

**Phase 2 corollary (job claiming):** every trader-side WRITE on a conversation/quote/booking must pass BOTH gates: (1) membership via `getActiveMembership()` (revoked members lose access even to records they created — a bare `row.traderUserId === userId` check is insufficient once teams exist), and (2) `canActOnJob()` from job-assignment (assignee-only on claimed jobs, 409 `JOB_CLAIMED_BY_OTHER`). Quote revise/withdraw originally shipped with only the ownership check and had to be retrofitted — new trader write paths must wire both from day one. Claiming writes (first message / first quote) instead use `claimOrRequireAssigned()` inside the same tx as the insert.

**Update (2026-08-09):** COMPANY_TEAMS_ENABLED=true is now LIVE in the production deployment environment (set via production env var; dev workspace still runs flag OFF). Boot backfill in prod was a no-op (all owner memberships already present; conversation mirroring correctly skipped with flag ON). Rollback = set the production env var to false and republish — data (company_members/company_invites/assigned_* columns) stays in place and is ignored by flag-off code.
