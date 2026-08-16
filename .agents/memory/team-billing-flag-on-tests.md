---
name: Team billing flag-ON test matrix
description: Why the API suite "fails" when TEAM_BILLING_ENFORCED=true is exported globally, and which combos are meaningful.
---

Running the full API suite with `TEAM_BILLING_ENFORCED=true` exported globally produces ~8 failures in company-team/company-jobs invite flows (403 instead of 201/409).

**Why:** those tests create companies with no team-product subscription and no seat exemption; under global enforcement the seat allowance is 0 and invites fail closed with 403 — that is the enforcement working as designed, not a regression. Enforcement-specific behavior is covered by `team-billing.test.ts`, which sets and restores both flags itself and passes in every combo.

**How to apply:** the meaningful matrix combos are (a) default env — everything green; (b) prod-like `COMPANY_TEAMS_ENABLED=true` only — everything green (one `skipIf` test correctly skips); (c) both flags ON — expect the invite-flow 403s, don't chase them as bugs. Never "fix" the invite tests to pass under global enforcement by weakening the seat gate.
