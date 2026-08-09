---
name: Email deliverability (Brevo)
description: How MyLocalTrade sends mail and the agreed plan/constraints for fixing spam/inbox placement.
---

# Email deliverability

App sends via Brevo HTTPS API with category-keyed keys (verification / notifications / contact),
sender `noreply@mylocaltrade.co.uk`, SMTP fallback. Code lives in `artifacts/api-server/src/lib/email.ts`.

## Root cause of "goes to spam / unverified sender"
Almost always DNS sender authentication, NOT code. Fix is on the user's side:
authenticate the domain in Brevo (SPF `include:spf.brevo.com`, DKIM `brevo._domainkey`,
domain verification TXT) + a DMARC record at `_dmarc.mylocaltrade.co.uk`, then verify in Brevo.

## Silent outage: free-plan daily quota (Aug 2026 incident)
Brevo plan is FREE = 300 emails/day (`GET /v3/account` → `plan[0]` credits, type sendLimit). At 0
credits the API still returns **201 + messageId but silently DROPS the mail** — no events, no
delivery, no error. Prod password resets died this way after a test run with real keys in env sent
hundreds of fixture emails (`@example.test`) through the shared account.
**Fast diagnostics** (events are account-wide regardless of which key you use):
1. self-send to `noreply@mylocaltrade.co.uk` → 201 but no events = account not sending;
2. `/v3/smtp/statistics/reports?days=N` per-day requests-vs-delivered (test blasts show as
   requests spikes with ~0 delivered);
3. `/v3/account` plan credits.
**Guards now in code (do not remove):** `dispatchEmail` refuses RFC 2606/6761 reserved test domains
(`example.com/org/net`, `.test`/`.example`/`.invalid`/`.localhost`) and `test-setup.ts` strips
`BREVO_API_KEY_*`/`SMTP_*` so vitest can never use a real transport.
Quota resets daily; real traffic is tiny (2–6/day), so post-fix the free plan suffices unless
volume grows.

## DNS / account status (verified Aug 2026)
DKIM `brevo1`/`brevo2._domainkey` + DMARC (`p=none`, rua→brevo) live; domain Authenticated+Verified
in Brevo (SPF include is outlook-only — acceptable with dedicated Brevo DKIM). Prod and workspace
Brevo keys belong to the SAME Brevo account (confirmed via account-wide event history), so dev
sends and prod sends share one daily quota.

## Agreed code-hardening plan (deferred until DNS is verified)
When the user confirms the domain shows Authenticated in Brevo, add as an extra delivery boost:
- A plain-text alternative for every email (Brevo `textContent`) — HTML-only mail is penalised.

**Constraint (user preference):** Do NOT add a `List-Unsubscribe` header to OTP / verification /
transactional emails. `List-Unsubscribe` is for marketing/bulk mail only.
**Why:** unsubscribe on transactional mail is wrong UX and can confuse delivery semantics.
**How to apply:** if List-Unsubscribe is ever added, gate it to the `notifications`/marketing
category only, never `verification`.
