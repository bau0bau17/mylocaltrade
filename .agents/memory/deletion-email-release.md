---
name: Account deletion email release
description: Deleted accounts must free their email for re-registration while audits stay; where release happens and the TOCTOU guard.
---

# Account deletion — email release

**Rule:** every terminal deletion path must release the unique email (rewrite
to a `*.invalid` placeholder on `users` AND the `trader_profiles` mirror) while
keeping the row so audits/reviews/conversations stay referentially intact.
Release happens in two places: the admin **anonymise** route (full PII wipe)
and the admin **complete** route (email only). Registration additionally
reopens any leftover lifecycle rows via `releasePriorEmail` (covers rows
completed before this rule existed).

**Why:** originally only anonymise freed the email; admin "complete" left it,
so a deleted user could never re-register — real prod incident.

**How to apply:**
- Placeholders: `deleted-user-<id>@deleted...` (terminal states, stable) and
  `released-<id>-<ts>@released...` (freed at re-registration). Detect "already
  released" via `email.endsWith(".invalid")` — keep that convention.
- `releasePriorEmail` re-validates lifecycle state in the UPDATE's WHERE and
  throws `EmailReuseConflictError` (mapped to 409) if zero rows matched —
  never drop that guard, it prevents a concurrent deletion-cancel from having
  its email stripped (TOCTOU).
- Never store the released real email in audit details (defeats erasure); the
  `ACCOUNT_REOPENED` / `ACCOUNT_DELETION_COMPLETED` audits link by user id.
