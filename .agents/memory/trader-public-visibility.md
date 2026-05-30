---
name: Public trader visibility policy
description: All customer-facing trader retrieval endpoints must enforce the same "is this trader publicly discoverable" rules; the checks are NOT centralized and drift easily.
---

`isTraderProfilePublic()` in `artifacts/api-server/src/lib/trader-status.ts` is the
canonical rule, but most public routes do NOT call it — they re-implement the
predicate inline as Drizzle `where` conditions or post-fetch filters. The known
public surfaces that each independently gate trader visibility:

- `GET /traders` (list) and `GET /traders/featured` — Drizzle `where` conditions
- `GET /traders/:id` (detail) — post-fetch 404 guard
- `GET /saved-traders` — JS `.filter`
- `GET /traders/:id/reviews` (in `routes/reviews.ts`) — post-fetch 404 guard

**Why:** because the rule is duplicated, adding a new hide condition (e.g.
`revalidationOverdue` for periodic re-validation) requires editing EVERY one of
these paths. A code review caught two endpoints (`/traders/:id/reviews` and the
saved/list paths) that still leaked hidden traders after a new flag was added to
only some routes. The reviews endpoint is especially easy to miss because it
lives in a different file and originally only checked trader existence by ID.

**How to apply:** whenever you add a new condition that makes a trader non-public
(suspension, expiry, lapsed re-validation, deletion lifecycle, subscription
gating), grep for all of the above routes and update each one. Prefer adding the
condition to the shared rule and routing all endpoints through it to stop the
drift. Status allow-list for non-detail public reads is
`["VERIFIED","UNDER_REVIEW","PENDING_DOCUMENTS"]` (duplicated as `VISIBLE_STATUSES`
in `traders.ts` and `PUBLIC_TRADER_STATUSES` in `reviews.ts`).
