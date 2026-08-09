---
name: Job reassignment & removal handover invariants
description: Company Teams Phase 3 — how reassignment/handover stay atomic and duplicate-free; what future job-lifecycle changes must preserve.
---

**Rule:** `SELECT … FOR UPDATE` on the **conversations row** is the single serialization point for every trader-side job write (claim, reassign, removal handover, message/quote/booking/close/cancel/mark-done). Pre-transaction `canActOnJob` checks are fast-path courtesy only; the in-transaction locked re-read (`requireAssignedInTx` / `claimOrRequireAssigned` / `reassignJobTx`) is the enforcement. First commit wins; losers roll back whole transactions and surface 409s (`JOB_CLAIMED_BY_OTHER`, `ALREADY_ASSIGNED`, `JOB_NOT_ACTIVE`).

**Why:** Any new trader-side write path that skips the in-tx guard reopens the stale-snapshot race (acting on a job that was reassigned/cancelled between read and write). Duplicated side effects (customer system messages, pushes, audits) came up repeatedly in review — the design only prevents them if side effects stay **post-commit, winner-only**.

**How to apply:**
- New trader-side conversation mutations MUST wrap the write in a transaction and call the in-tx assignment guard; catch `JobClaimedByOtherError` → 409. This includes "soft" CRM-ish fields (trader pipeline status) — they feed review eligibility.
- Reassignment re-validates the TARGET inside the transaction: `FOR SHARE` on the target's company_members row serializes against removal's conditional ACTIVE→REVOKED UPDATE, so a live job can never end up assigned to a revoked member (route-level membership checks are courtesy only). Profile owner passes without a row. No deadlock: the conv being reassigned is never in removal's handover set (ALREADY_ASSIGNED short-circuits first).
- Derived conversation updates that follow a guarded write (e.g. marking QUOTED after a quote insert) belong INSIDE the same transaction, and regression guards go in SQL (`ne(status, 'COMPLETED')`), never on a pre-transaction snapshot.
- Reassign/handover side effects (postSystemMessage, pushes, audit rows) run only after the committing transaction returns — never inside it, never for losers. Same-target retry = `ALREADY_ASSIGNED`, zero side effects.
- Removal handover is atomic with the conditional `ACTIVE→REVOKED` membership flip (at-most-once by construction); completed/cancelled jobs keep their historical assignee (predicate mirrors `deriveStage`: cancelledAt/customerCompletedAt null, status not CLOSED/BLOCKED). ONE aggregate `JOBS_HANDED_TO_OWNER_ON_MEMBER_REMOVAL` audit per removal (details.conversationIds is an ARRAY — per-conv audit helpers won't find it).
- Notification rules: customer always; new assignee unless they are the actor; previous assignee only if still active AND not actor AND not target. Never the acting owner or a removed member.
- `viewerCanReassign` is computed server-side on the detail GET only (owner + flag ON + live stage + currently assigned); the mobile UI must gate purely on it, never on local role logic.
- Audit anchoring: job audit rows anchor `userId` to the company owner via `companyAnchor`; action column is varchar + TS const array, so new actions need no DB migration.
