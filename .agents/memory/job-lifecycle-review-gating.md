---
name: Job lifecycle and review gating
description: The hire/complete/cancel state machine for conversations and the invariants that keep reviews trustworthy
---

# Job lifecycle and review gating

The conversation lifecycle is customer-driven. Review eligibility hangs off
`customerCompletedAt` (the customer CONFIRMING done), never off the trader.

**Invariants (do not break):**
- Only the hiring customer can unlock a review, via `/conversations/:id/complete`
  (sets `customerCompletedAt` + `reviewUnlockedAt` + `traderStatus=COMPLETED`).
- The trader's `/conversations/:id/trader-mark-done` is NOTIFICATION-ONLY: it sets
  `traderMarkedDoneAt` and pings the customer, but must never write
  `customerCompletedAt`/`reviewUnlockedAt`.
- Cancelled jobs (`cancelledAt` set) are NEVER review-eligible. Both review paths
  must exclude them: `POST /reviews` rejects when `cancelledAt` is set, and
  `GET /reviews/eligible` adds `isNull(cancelledAt)`. Gating only on
  `customerCompletedAt` is insufficient.
- Cancellation requires a short reason (3–500 chars), either party, only before
  completion; it also closes the conversation.

**Why:** reviews are public trust signals. If the trader could self-confirm or a
cancelled job stayed reviewable, traders could farm or dodge reviews.

**Single source of truth for UI:** `deriveStage(c)` on the server returns
`stage` (precedence CANCELLED > JOB_DONE > AWAITING_CUSTOMER_CONFIRMATION >
HIRED > CLOSED > AWAITING_REPLY). Mobile thread + list pills and action-bar
visibility consume `stage`, NOT the raw `status`/`traderStatus`, so the headline
never contradicts the real state (e.g. no stale "NEW" after hire). Any new
lifecycle state must be added to deriveStage AND both mobile consumers in lockstep.

**Action-bar symmetry (mobile thread):** the customer branch is a catch-all
(`!isTrader && !closed`) so the customer ALWAYS sees a lifecycle bar. The trader
branch must mirror this — use `isTrader && !closed` as a catch-all with
sub-branches per stage (pre-hire hint "waiting to be hired", HIRED → "Mark work
as completed", AWAITING_CUSTOMER_CONFIRMATION → waiting hint). A previous version
gated the trader branch strictly to HIRED/AWAITING_CUSTOMER_CONFIRMATION, so the
trader saw NOTHING before hire and it looked like "the workflow isn't implemented
on the trader side". **Why:** both parties must always perceive the same job state.

**Stale trader-status copy:** the legacy `traderStatus` dropdown (NEW/IN_PROGRESS/
COMPLETED) is display-only now and must NOT claim COMPLETED "unlocks customer
review" — only customer-confirm does. Keep that copy aligned with the gating.

**Dev server has no hot-reload:** api-server `dev` is plain `tsx ./src/index.ts`
(no `watch`). After editing server code you MUST restart the api-server workflow
or it keeps serving stale code (e.g. responses missing the new `stage` field).
