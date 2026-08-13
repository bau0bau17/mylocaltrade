---
name: Campaign retention lifecycle rules
description: Deletion/archive/anonymisation invariants for early-access campaigns; what future changes must never break.
---

# Campaign retention lifecycle (shipped Aug 2026)

Schedule and rationale live in `docs/data-retention.md` — keep that file in lockstep with any behaviour change, and keep it inside the Privacy Policy's public commitments (assessed sufficient; transparency-only, no version bump / re-acceptance).

Rules future changes must never break:

- **Hard delete** is only for never-queued drafts with zero recipients, zero batches AND no send activity — **TEST_SENT counts as send activity** (a real email left the system). Blocking events checked inside the delete tx while holding the campaign row FOR UPDATE. The CAMPAIGN_DELETED audit event intentionally outlives the row (events have no FK); don't "clean up" dangling campaignId events.
- **Test-send serializes with delete** by taking the campaign row lock inside its quota tx (lock order quota→row; delete takes only the row lock, no cycle). Removing that lock reopens a race where a test email is sent for a just-deleted campaign.
- **Archive** is terminal-statuses-only (completed/partially_failed/cancelled), reversible, conditional-update gated (double-click = one audit event). Default campaign list hides archived; `?includeArchived=1` + `archivedCount` in the response.
- **Anonymise-recipients** blanks emailNormalized/name and NULLs registrationId/outreachContactId but MUST keep status/batchNumber/**sentAt** — sentAt drives daily-quota accounting and status drives aggregate stats. Idempotency predicate is `emailNormalized <> ''`. Audit event carries counts only.
- No retention operation may ever write to outreach_suppressions, outreach_contacts, registrations or consent fields — regression-tested in `campaign-retention.test.ts`.

**Why:** legal/audit requirement — recipient communications history must be preservable while personal data becomes deletable; suppression evidence is the opt-out guarantee.
