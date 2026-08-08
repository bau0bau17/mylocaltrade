---
name: Single-login company model (no team members)
description: Every trader business is exactly one user login; no membership/roles architecture exists — critical context for any "employees/team/assigned person" request
---

Verified Aug 2026 by full schema/API/mobile sweep:

- `trader_profiles.userId` is `.notNull().unique()` → strictly 1 user ↔ 1 trader profile. No members, memberships, employees, teams, or invites tables/routes/screens exist anywhere.
- `trader_profiles.businessRole` (OWNER/DIRECTOR/MANAGER/EMPLOYEE/SELF_EMPLOYED/OTHER) is **self-declared verification metadata** about the person who completed onboarding — NOT access control. Never gate UI or API on it: a legitimate single-login business may have declared any role, and hiding controls (e.g. logo upload) from them would lock the business's only login out of its own settings.
- `canManageBusinessFields()` (api-server business-permissions) is the future-proofed choke point for business-level fields (logo, name, services, address…): today trivially owner-only. If team roles are ever added, deny inside that helper — never by UI hiding alone.
- Quote/conversation identity is already per-user: quotes carry `traderUserId`, messages carry `senderUserId`, bookings carry proposer/confirmer audit user ids. One PENDING quote per conversation and one live booking per conversation are DB-enforced partial unique indexes.

**Why:** a user spec assumed existing "company roles, members, assigned person" architecture and asked to reuse it; exploration proved none exists. Requests like "employees must not see X" or "first member to quote claims the job" are **new-architecture projects** (memberships table, invites, auth broadening across every trader route, conversation access model), not tight scoped fixes.

**How to apply:** if a request mentions employees/team members/assigned person, first state that the product is single-login-per-business today, deliver the parts that apply, and scope multi-member support as its own project if wanted.
