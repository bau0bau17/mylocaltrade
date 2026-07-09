---
name: Email case-insensitivity & legacy duplicates
description: Email lookups must be case-insensitive; prod has a legacy case-variant duplicate pair that blocks a unique lower(email) index.
---

# Email case-insensitivity

Registration historically stored emails with the casing the user typed, and all
lookups were exact `eq` — so users who typed a different casing at login/reset
silently failed.

**Rule:** every user lookup by email must be case-insensitive
(`lower(email) = lower(input)`), and new registrations store email lowercased.

**Legacy duplicates:** production contains a real case-variant pair — the same
address exists once all-lowercase (customer account) and once with a capital
first letter (trader account), same person, two live accounts created under
the old case-sensitive checks. Find it with:
`SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1`.
Because of this:
- Single-user lookups must be deterministic: prefer exact typed casing, then
  the canonical all-lowercase row, then lowest id (see `findUserByEmail` in
  auth routes). Pass the email **as typed** (trim only) into the helper —
  pre-lowercasing defeats the exact-casing precedence.
- **Never add a unique index on `lower(email)`** without first resolving that
  prod duplicate; the migration would fail.

**Why:** case-insensitive `limit 1` without ordering resolves duplicates
nondeterministically — login/password-reset could land on the wrong account.

**How to apply:** any new email lookup (new routes, admin tools, scripts) must
use the helper or replicate its ordering; duplicate checks at registration are
case-insensitive so no new duplicates can appear.
