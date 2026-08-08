---
name: Company membership choke point
description: Company Teams access rules — the single membership resolver, the owner-only fail-closed-by-construction pattern, backfill semantics, and the flag-enable precondition.
---

# Company membership choke point (Company Teams)

**Rule 1 — one resolver.** `getActiveMembership(userId)` in the API server's lib is the ONLY place that answers "which trader business does this caller act for, and with what role?". Member-shared surfaces (conversations actor context, enquiries list/new-count, quotes profile resolution, bookings participant role, reviews list, reports trader branch, profile GET) all call it. Never reintroduce per-route `trader_profiles.user_id = callerUserId` lookups on shared surfaces.

- Flag OFF (`COMPANY_TEAMS_ENABLED` unset/false, the default): resolver is bit-identical to the legacy owned-profile lookup, role always OWNER.
- Flag ON: ACTIVE `company_members` row wins; owner-without-row falls back to owned profile (backfill safety); REVOKED/no row ⇒ null (fail closed).
- The resolver ENFORCES (not assumes) that an OWNER membership matches `trader_profiles.user_id`; forged/corrupt OWNER rows fail closed with an integrity-violation error log.

**Rule 2 — owner-only routes are fail-closed by construction.** Mutation/secret surfaces (profile PUT, documents, phone OTP, subscriptions, review replies, profile-change requests, onboarding/legal) were deliberately LEFT on owned-profile (`user_id`-keyed) lookups: employees own no `trader_profiles` row, so they hit the existing 404/403 paths. Do NOT "helpfully" swap these to the membership resolver — that would grant employees owner powers. Friendly `OWNER_ONLY` 403s are a UI-phase addition (gate BEFORE the legacy lookup), never a swap.

**Why:** one resolver keeps multi-member authorization auditable in a single file; the untouched owner-only routes mean flag-off behavior provably cannot drift and employees fail closed even if route code is forgotten.

**Backfill:** boot-time, idempotent (`ON CONFLICT DO NOTHING` — never resurrects revocations). Conversation `assigned_trader_user_id` mirroring from `trader_user_id` runs ONLY while the flag is off; once claiming ships, NULL = legitimately unclaimed. Errors are loud but non-fatal (owner fallback keeps businesses working).

**Flag precondition:** never enable `COMPANY_TEAMS_ENABLED` in production before job claiming/assignment enforcement ships — with the flag on, every ACTIVE member counts as trader participant of ALL company conversations (messages, quotes, bookings), which is only safe once claim rules exist.

**How to apply:** any new trader-side route decides first: member-shared (use the resolver) or owner-only (owned-profile lookup, optionally + explicit owner gate). Tests that touch the flag must save/restore the external env value (single-fork vitest shares the process with the equivalence run `COMPANY_TEAMS_ENABLED=true`).
