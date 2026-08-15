---
name: Account deletion storage gap
description: Deletion lifecycle clears DB references but never deletes private storage objects or trader_documents; must be fixed before App Store launch.
---

The rule: the account-deletion lifecycle (request → anonymise → complete) is a **soft delete** — it clears DB references (avatar_url, logo_url, gallery_urls) and anonymises PII, but it **never deletes the underlying object-storage files** and never touches `trader_documents` rows/objects. Deleted users' verification documents, avatars, logos and gallery files stay orphaned in the private bucket.

**Why:** confirmed via full code exploration + production inventory during the Aug 2026 test-account reset. User explicitly classified it as a pre-launch blocker: before the public App Store release, valid deletion must remove those files or place them beyond use per a documented retention rule (tracked as a follow-up task; see also docs/data-retention.md).

**How to apply:** don't claim account deletion removes files; when the fix is built, do object cleanup best-effort post-commit (never abort the finalisation transaction), reuse the admin document-deletion object pattern, and document the retention rule. Do not retroactively clean the Aug 2026 reset accounts without explicit instruction.

Related facts from the same inventory (durable):
- RC App User ID = numeric users.id; pre-launch purchases orphaned on $RCAnonymousID customers, all sandbox (TestFlight-only app) — RC customers "7"/"8" held zero purchases despite a local premium subscription row.
- The RevenueCat connector's proxyFetch only accepts v2 API paths (`/v2/projects/...`); v1 `/v1/subscribers/...` returns 401.
- Admin identity space really is separate: an admin row sharing an email with an app-space account does not block app-space re-registration and is refused by the deletion flow.
