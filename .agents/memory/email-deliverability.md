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

## Agreed code-hardening plan (deferred until DNS is verified)
When the user confirms the domain shows Authenticated in Brevo, add as an extra delivery boost:
- A plain-text alternative for every email (Brevo `textContent`) — HTML-only mail is penalised.

**Constraint (user preference):** Do NOT add a `List-Unsubscribe` header to OTP / verification /
transactional emails. `List-Unsubscribe` is for marketing/bulk mail only.
**Why:** unsubscribe on transactional mail is wrong UX and can confuse delivery semantics.
**How to apply:** if List-Unsubscribe is ever added, gate it to the `notifications`/marketing
category only, never `verification`.
