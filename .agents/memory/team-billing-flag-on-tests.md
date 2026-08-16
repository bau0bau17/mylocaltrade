---
name: Team billing flag-ON test matrix
description: How the API suite stays green with TEAM_BILLING_ENFORCED=true exported globally, and the fixture conventions that make it work.
---

The full API suite must pass in all three matrix combos: (a) default env; (b) prod-like `COMPANY_TEAMS_ENABLED=true` only (one `skipIf` test correctly skips); (c) both flags ON.

**Why:** seat allowance derives from the inviting owner's subscription product in EVERY regime (accounting/enforcement split — see team-seat-accounting-split.md). Test companies with no team product get allowance 0 and invites 403 fail-closed in all combos — that is the gate working as designed, so tests must supply real seat context instead of weakening it.

**How to apply (fixture conventions in company-team / company-jobs tests):**
- Fixture owners that invite through the real endpoint get an active subscription with a placeholder team product (`test.placeholder.team20.*`) registered per-file via `TEAM_PRODUCT_SEAT_MAP` (save/restore the external value; only seats 5/10/20 are valid; consulted in EVERY regime).
- Shape assertions that legitimately differ between regimes branch on a module-load `BILLING_ON` const — now only enforcement-linked fields differ: `seats.enforcement`/`seatEnforcementActive` booleans and `seats.allowance` presence (on-only).
- Seat-cap tests use `COMPANY_MAX_ACTIVE_MEMBERS=1` — it trips BOTH regimes (plan-based employee-only count clamped by the kill-switch ceiling everywhere).
- A test that needs a plan-less owner (exemption-is-the-allowance scenarios) deletes and restores the fixture subscription inside its own try/finally, and restores `TEAM_BILLING_ENFORCED` to its PRIOR value, never blind-deletes it (blind delete silently turns the rest of the file into billing-off under the both-ON combo).
- Subscriptions rows must be deleted in afterAll BEFORE users (FK).
- Never "fix" flag-ON failures by bypassing enforcement or weakening production seat gates.
