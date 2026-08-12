---
name: Early Access consent model
description: Consent, unsubscribe and export rules for the early_access_* tables and landing form
---

# Early Access consent model (Phase 1 + Phase 2A double opt-in, Aug 2026)

**Rules:**
- Launch consent and marketing consent are SEPARATE: each has its own `...ConsentAt` + `...ConsentVersion` on `early_access_registrations`, with wording constants in `artifacts/api-server/src/lib/early-access-consent.ts` (`CONSENT_WORDING_BY_VERSION` maps version → exact text shown). Never infer marketing consent from registration alone — only `marketingConsent === true` in the submission.
- The landing form is UNAUTHENTICATED, so a re-submission must NEVER lift an existing unsubscribe/suppression (`unsubscribedAt` + `unsubscribeSource 'user'|'admin'`) — otherwise a third party who knows an address could reverse someone's opt-out. Evidence events are still recorded (`early_access_events`) for a future verified flow/admin.
- CSV exports are consent-purpose constrained SERVER-side: `purpose=launch|marketing` forces recorded consent + subscribed; default excludes opted-out; `includeSuppressed=true` requires `confirmAll=true`. Every export writes a `CSV_EXPORTED` audit event with counts/filters only — never recipient lists in event details.
- Admin suppression is a conditional UPDATE + audit event in ONE transaction (suppression must never exist without its `ADMIN_SUPPRESSED` evidence).
- Landing form + privacy policy live in compiled landing-site bundles (lockstep-edit rule applies); launch-consent wording in the bundle must exactly match `LAUNCH_CONSENT_VERSION` wording.
- Privacy policy section 11 promises withdrawal via contact form + unsubscribe links in future marketing emails — Phase 2B (campaigns) MUST include a signed unsubscribe link.
- Double opt-in (Phase 2A) IS implemented: submissions store `pending*` versions + a sha256 `confirmationTokenHash` (48h, single-use, FOR UPDATE-serialized); consent `...ConsentAt` columns are set ONLY at confirm time. GET never activates — the `/confirm-early-access` static page (no-referrer, no-store, token stripped from history) needs an explicit POST to `/api/early-access/confirm`. All confirm failures collapse to one generic 400.
- Confirm lifts a `user` unsubscribe only; `admin` suppression survives confirmation AND blocks new confirmation emails (public + admin resend). Send cap: 3 `CONFIRMATION_SENT` events per rolling 24h, counted from the events table.
- Phase 1 legacy rows keep `launchConsentAt` set with `confirmedAt` NULL — never backfill `confirmedAt`; they stay export-eligible and admins cannot initiate a confirmation for them (flows must start from the person's own submission).
- Prod migration lockstep: the Phase 2A columns must be schema-pushed to the prod DB before/with the deploy or early-access routes break.

**Why:** GDPR/PECR-defensible evidence + architect review findings (forged-consent and opt-out-reversal attacks on unauthenticated forms).

**How to apply:** any change to `early-access.ts`, `admin-early-access.ts`, the landing form bundle, or Phase 2 email campaigns must preserve these invariants.
