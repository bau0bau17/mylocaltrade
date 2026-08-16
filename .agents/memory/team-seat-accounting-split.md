---
name: Team seat accounting vs enforcement split
description: Seat display/invite gating is ALWAYS plan-based; TEAM_BILLING_ENFORCED gates only destructive machinery. Contract details and back-compat rules.
---

Seat **accounting** and seat **enforcement** are two separate layers (split Aug 2026 after the P0 "2 of 10 seats used" incident):

- **Accounting (ALWAYS on, every regime):** seats derive from the owner's `subscriptions.product_identifier` via `getCompanyPlanContext` — Solo = 0 employee seats, Team tiers = their mapped seats; the OWNER never occupies a seat; pending invites are reported separately as reserved. Applies to GET /company/team, /company/team-context, and invite create/resend/accept. `COMPANY_MAX_ACTIVE_MEMBERS` is only a kill-switch ceiling when explicitly set — never a seat allowance, never a display value.
- **Enforcement (`TEAM_BILLING_ENFORCED` only):** suspension reconciliation, hourly sweep, owner suspend/reactivate routes (404 when off). Flag off ⇒ nobody is ever suspended; over-allowance members are grandfathered in place, but NEW invites are blocked (403 TEAM_PLAN_REQUIRED).

**Why:** the pre-split legacy branch (flag off) counted the owner and presented the env-default cap 10 as an allowance — a Solo owner saw "2 of 10 seats used".

**How to apply:**
- Never reintroduce a flag-off branch that derives display or invite caps from `COMPANY_MAX_ACTIVE_MEMBERS` or counts the owner.
- `seats.allowance` is emitted ONLY when enforcement is on: the shipped mobile build keys its suspend/reactivate UI on `allowance`'s presence, and those routes 404 while off. New builds read `seats.enforcement` (with allowance-presence fallback).
- Invite RESEND must re-check the plan under the per-company advisory lock for LIVE invites too, not just expired ones (Team→Solo downgrade must not keep rotating tokens/re-emailing); expired invites additionally re-check capacity because they re-enter the pending pool.
- Old build + new server (flag off) shows "1 of 0 seats used" — truthful, accepted transition.
- If the flag is ever enabled in prod, grandfathered companies need a seat exemption FIRST or their employees get suspended (company 6 has one grandfathered employee and NO exemption).
