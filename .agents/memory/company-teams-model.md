---
name: Company model — owner + employees (Teams shipped)
description: Company Teams REPLACED the old single-login-per-business model; what the membership architecture is and which old rules still hold.
---

Company Teams (Phases 0–3, Aug 2026) ended the single-login era. Current model:

- `company_members`: role OWNER/EMPLOYEE, status ACTIVE/REVOKED, one ACTIVE company per user (partial unique index). Employees are full `users` rows with `role='trader'` and NO owned trader_profile.
- `COMPANY_TEAMS_ENABLED` is a GLOBAL server env flag (not per-company). Fail-closed: flag OFF hides team routes/UI, but data-safety paths (removal/deletion job handover, membership-scoped serving) are deliberately flag-INDEPENDENT.
- `getActiveMembership()` is the sole resolver (see company-membership-choke-point.md). Employee blocks on billing/business-profile/logo/documents/team-mgmt/phone-OTP are OWNERSHIP checks inside handlers (owned-profile / own-subscription-row lookups → 403/400/404), NOT role middleware — new trader routes must add the same ownership check, `traderOnly` alone does not exclude employees.
- Still true from the old model: `trader_profiles.businessRole` is self-declared verification metadata, NEVER access control; `canManageBusinessFields()` stays the choke point for business-level fields (owner-only today).
- Employee account essentials are identical to any user (password reset via OTP flow, sign-out, legal, support, self-service deletion). Personal identity = `users.avatarUrl` (membership-gated serving); business identity = `logoUrl` (public). See avatar-vs-logo-identity.md.

**Why:** an earlier memory ("single-login company model") claimed no teams architecture exists; acting on it after Phases 0–3 shipped would misdiagnose employee requests as new-architecture projects and reintroduce owner-only assumptions.

**How to apply:** for any employees/team/assigned-person request, assume the membership architecture EXISTS and route through getActiveMembership + the ownership choke points; scope checks per surface (userId-keyed surfaces need the explicit employee gate).
