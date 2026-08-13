# Data retention — Early Access & Outreach marketing data

Status: current as of August 2026. This is the internal retention schedule
for the marketing/outreach subsystem (Early Access registrations, Outreach
Contacts, campaigns). Public-facing commitments live in the Privacy Policy
(landing site, sections 7, 11 and 12); this document must stay consistent
with it.

## Campaign lifecycle rules (enforced in code)

| State | Allowed operation | What happens |
| --- | --- | --- |
| Draft, never queued (no recipient snapshot, no batches, no send activity — test emails count as send activity) | **Hard delete** (`DELETE /admin/early-access/campaigns/:id`) | Campaign row removed. A `CAMPAIGN_DELETED` audit event is written and kept — it records only non-identifying facts (internal name, type, audience, created date, acting admin). A draft that has produced a test email keeps its full history and cannot be deleted. |
| Ever queued, sent, partially sent or cancelled | **Archive** (`POST …/:id/archive`, reversible via `…/unarchive`) | Row is hidden from the default admin list (shown via the "Show archived" filter). Nothing is deleted; the full audit trail, batches and recipient snapshot are preserved. Only finished campaigns (completed / partially failed / cancelled) can be archived — active ones must be cancelled first. |

Archiving never deletes or modifies suppression, unsubscribe, complaint,
bounce or consent evidence. Those live in separate tables
(`outreach_suppressions`, `outreach_contacts` evidence fields,
`early_access_registrations` consent fields, event tables) that no campaign
lifecycle operation writes to.

## Retention schedule

| Data | Contains personal data? | Retention | Mechanism |
| --- | --- | --- | --- |
| Campaign content & metadata (`early_access_campaigns`) | No (internal name, subject, body copy) | Indefinite (archived when finished) | Archive filter |
| Recipient snapshot (`early_access_campaign_recipients`) | Yes (normalised email, first name) | Keep while the campaign is active, then **up to 12 months after completion/cancellation** for complaint handling and audit, after which recipient rows are anonymised | `POST …/:id/anonymise-recipients` (admin-triggered; blanks email + name, unlinks registration/contact ids; keeps per-recipient status, batch number and sent date so aggregate statistics and daily-quota accounting survive; writes a `RECIPIENTS_ANONYMISED` event with counts only) |
| Campaign audit events (`early_access_campaign_events`) | No (counts, ids, flags — never recipient lists or content) | Indefinite | — |
| Batch records (`early_access_campaign_batches`) | No (counts + Brevo object ids) | Indefinite | — |
| Early Access registrations | Yes | Until the launch period ends or the person requests deletion (Privacy Policy §7) | Existing admin deletion/suppression flows |
| Outreach contacts (`outreach_contacts`) | Yes (business contact details + lawful-basis evidence) | While the lawful basis stands; deleted on request | Existing contact deletion flow |
| Suppression list (`outreach_suppressions`) | Minimal (normalised email + reason + source + date only) | **Indefinite by design** — the minimum data needed to guarantee we never email the person again. Deleting it would break the opt-out promise. | Never deleted by any campaign/contact operation |

The 12-month anonymisation window is an operational maximum, not an
automatic timer: an admin runs "Anonymise recipient data" from the campaign
page once the window (or an earlier deletion request) makes the personal
data unnecessary. Anonymisation is idempotent and irreversible.

## Privacy Policy assessment (August 2026)

Checked against the live policy (landing site `privacy-policy` page):

- §7 Data Retention already covers Early Access submissions ("retained
  until the launch period ends or you request deletion") and audit records
  ("retained where needed").
- §11 already states we keep "a minimal record of your request so that we
  do not contact you again" after consent withdrawal.
- §12 already promises the permanent suppression list and deletion of
  remaining business-contact details on request.

The schedule above fits inside those public commitments, so **no public
legal text change is required and no user re-acceptance is triggered**. If
the schedule ever loosens (longer identifiable retention, new purposes),
the policy must be updated first.
